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


import { 
  OktaAuth,
  IdxTransaction,
} from '../types';
import { run } from './run';
import { AuthenticationOptions } from './authenticate';
import { RegistrationOptions } from './register';
import { PasswordRecoveryOptions } from './recoverPassword';
import { getSavedTransactionMeta } from './transactionMeta';
import { getFlowSpecification } from './flow';
import { AuthSdkError } from '../errors';

export type ProceedOptions = AuthenticationOptions
  & RegistrationOptions
  & PasswordRecoveryOptions;

export function canProceed(authClient: OktaAuth, options?: { state?: string }) {
  const meta = getSavedTransactionMeta(authClient, options);
  return !!meta;
}

export async function proceed(
  authClient: OktaAuth,
  options: ProceedOptions = {}
): Promise<IdxTransaction> {
  const { state } = options;
  const meta = getSavedTransactionMeta(authClient, { state });

  // Proceed always needs saved transaction meta
  if (!meta) {
    throw new AuthSdkError('Unable to proceed: saved transaction could not be loaded');
  }

  // Determine the flow specification based on the saved flow
  const flowSpec = getFlowSpecification(authClient, meta?.flow);

  return run(authClient, { 
    ...options, 
    ...flowSpec
  });
}
