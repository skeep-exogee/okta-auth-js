import { OktaAuth, FlowIdentifier } from '../../types';
import { AuthenticationFlow } from './AuthenticationFlow';
import { AuthenticationFlowMonitor } from './AuthenticationFlowMonitor';
import { FlowMonitor } from './FlowMonitor';
import { PasswordRecoveryFlow } from './PasswordRecoveryFlow';
import { PasswordRecoveryFlowMonitor } from './PasswordRecoveryFlowMonitor';
import { RegistrationFlow } from './RegistrationFlow';
import { RegistrationFlowMonitor } from './RegistrationFlowMonitor';
import { RemediationFlow } from './RemediationFlow';

export interface FlowSpecification {
  flow: FlowIdentifier;
  remediators: RemediationFlow;
  flowMonitor: FlowMonitor;
  actions?: string[];
  sso?: boolean;
}

export function getFlowSpecification(oktaAuth: OktaAuth, flow: FlowIdentifier = 'proceed'): FlowSpecification {
  let remediators, flowMonitor, actions, sso;
  switch (flow) {
    case 'register':
    case 'signup':
    case 'enrollProfile':
      remediators = RegistrationFlow;
      flowMonitor = new RegistrationFlowMonitor(oktaAuth);
      sso = false;
      break;
    case 'recoverPassword':
    case 'resetPassword':
      remediators = PasswordRecoveryFlow;
      flowMonitor = new PasswordRecoveryFlowMonitor(oktaAuth);
      actions = [
        'currentAuthenticator-recover', 
        'currentAuthenticatorEnrollment-recover'
      ];
      sso = false;
      break;
    default:
      // authenticate
      remediators = AuthenticationFlow;
      flowMonitor = new AuthenticationFlowMonitor(oktaAuth);
      sso = true;
      break;
  }
  return { flow, remediators, flowMonitor, actions, sso };
}
