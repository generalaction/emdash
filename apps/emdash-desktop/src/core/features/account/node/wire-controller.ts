import { createController, type Controller } from '@emdash/wire/api';
import { accountOperations } from '@main/core/account/controller';
import { accountContract } from '../api';

export function createAccountWireController(): Controller {
  return createController(accountContract, {
    getSession: () => accountOperations.getSession(),
    signIn: ({ provider }) => accountOperations.signIn(provider),
    linkProviderAccount: ({ provider }) => accountOperations.linkProviderAccount(provider),
    signOut: () => accountOperations.signOut(),
    checkHealth: () => accountOperations.checkHealth(),
  });
}
