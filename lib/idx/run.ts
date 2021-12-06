/*!
 * Copyright (c) 2015-present, Okta, Inc. and/or its affiliates. All rights reserved.
 * The Okta software accompanied by this notice is provided pursuant to the Apache License, Version 2.0 (the "License.")
 *
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0.
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * 
 * See the License for the specific language governing permissions and limitations under the License.
 */


/* eslint-disable max-statements, complexity, max-depth */
import { interact } from './interact';
import { introspect } from './introspect';
import { remediate } from './remediate';
import { FlowMonitor, RemediationFlow } from './flow';
import * as remediators from './remediators';
import { AuthSdkError } from '../errors';
import { 
  OktaAuth,
  IdxStatus,
  IdxTransaction,
  IdxFeature,
  NextStep,
  FlowIdentifier,
} from '../types';
import { IdxResponse, IdxRemediation } from './types/idx-js';
import { getSavedTransactionMeta } from './transactionMeta';
import { ProceedOptions  } from './proceed';

export type RunOptions = ProceedOptions & {
  flow?: FlowIdentifier;
  remediators?: RemediationFlow;
  flowMonitor?: FlowMonitor;
  actions?: string[];
  sso?: boolean;
}

function getEnabledFeatures(idxResponse: IdxResponse): IdxFeature[] {
  const res = [];
  const { actions, neededToProceed } = idxResponse;

  if (actions['currentAuthenticator-recover']) {
    res.push(IdxFeature.PASSWORD_RECOVERY);
  }

  if (neededToProceed.some(({ name }) => name === 'select-enroll-profile')) {
    res.push(IdxFeature.REGISTRATION);
  }

  if (neededToProceed.some(({ name }) => name === 'redirect-idp')) {
    res.push(IdxFeature.SOCIAL_IDP);
  }

  return res;
}

function getAvailableSteps(remediations: IdxRemediation[]): NextStep[] {
  const res = [];

  const remediatorMap = Object.values(remediators).reduce((map, remediatorClass) => {
    // Only add concrete subclasses to the map
    if (remediatorClass.remediationName) {
      map[remediatorClass.remediationName] = remediatorClass;
    }
    return map;
  }, {});

  for (let remediation of remediations) {
    const T = remediatorMap[remediation.name];
    if (T) {
      const remediator = new T(remediation);
      res.push (remediator.getNextStep());
    }
  }

  return res;
}

export async function run(
  authClient: OktaAuth, 
  options: RunOptions = {
    sso: true
  },
): Promise<IdxTransaction> {
  let tokens;
  let nextStep;
  let messages;
  let error;
  let meta;
  let enabledFeatures;
  let availableSteps;
  let status = IdxStatus.PENDING;
  let shouldClearTransaction = false;
  let clearSharedStorage = true;
  let idxResponse;
  let interactionHandle;
  let metaFromResp;

  try {

    const { flow, state, scopes } = options;

    // Only one flow can be operating at a time
    if (flow) {
      authClient.idx.setFlow(flow);
    }

    // Try to resume saved transaction
    metaFromResp = getSavedTransactionMeta(authClient, { state });
    interactionHandle = metaFromResp?.interactionHandle; // may be undefined

    if (!interactionHandle) {
      // start a new transaction
      authClient.transactionManager.clear();
      const interactResponse = await interact(authClient, { sso: options.sso, state, scopes }); 
      interactionHandle = interactResponse.interactionHandle;
      metaFromResp = interactResponse.meta;
    }

    // Introspect to get idx response
    idxResponse = await introspect(authClient, { sso: metaFromResp?.sso, interactionHandle });

    if (!options.remediators && !options.actions) {
      // handle start transaction
      meta = metaFromResp;
      enabledFeatures = getEnabledFeatures(idxResponse);
      availableSteps = getAvailableSteps(idxResponse.neededToProceed);
    } else {
      const values: remediators.RemediationValues = { 
        ...options, 
        stateHandle: idxResponse.rawIdxState.stateHandle 
      };

      // Can we handle the remediations?
      const { 
        idxResponse: idxResponseFromResp, 
        nextStep: nextStepFromResp,
        terminal,
        canceled,
        messages: messagesFromResp,
      } = await remediate(idxResponse, values, options);

      // Track fields from remediation response
      nextStep = nextStepFromResp;
      messages = messagesFromResp;

      // Save intermediate idx response in storage to reduce introspect call
      if (nextStep && idxResponseFromResp) {
        authClient.transactionManager.saveIdxResponse(idxResponseFromResp.rawIdxState);
      }

      if (terminal) {
        status = IdxStatus.TERMINAL;
        shouldClearTransaction = true;
        clearSharedStorage = false; // transaction may be continued in another tab
      } if (canceled) {
        status = IdxStatus.CANCELED;
        shouldClearTransaction = true;
      } else if (idxResponseFromResp?.interactionCode) { 
        // Flows may end with interactionCode before the key remediation being hit
        // Double check if flow is finished to mitigate confusion with the wrapper methods
        if (!(await options.flowMonitor.isFinished())) {
          throw new AuthSdkError('Current flow is not supported, check policy settings in your org.');
        }

        const {
          clientId,
          codeVerifier,
          ignoreSignature,
          redirectUri,
          urls,
          scopes,
        } = metaFromResp;
        tokens = await authClient.token.exchangeCodeForTokens({
          interactionCode: idxResponseFromResp.interactionCode,
          clientId,
          codeVerifier,
          ignoreSignature,
          redirectUri,
          scopes
        }, urls);

        status = IdxStatus.SUCCESS;
        shouldClearTransaction = true;
      }
    }
  } catch (err) {
    error = err;
    status = IdxStatus.FAILURE;
    shouldClearTransaction = true;
  }

  if (shouldClearTransaction) {
    authClient.transactionManager.clear({ clearSharedStorage });
  }
  
  return {
    _idxResponse: idxResponse, 
    status,
    ...(meta && { meta }),
    ...(enabledFeatures && { enabledFeatures }),
    ...(availableSteps && { availableSteps }),
    ...(tokens && { tokens: tokens.tokens }),
    ...(nextStep && { nextStep }),
    ...(messages && { messages }),
    ...(error && { error }),
  };
}
