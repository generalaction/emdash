import { createController, type Controller } from '@emdash/wire/rpc';
import { integrationOperations } from '@core/features/integrations/node/controller';
import { integrationsContract } from '../api';

export function createIntegrationsWireController(): Controller {
  return createController(integrationsContract, {
    list: () => integrationOperations.list(),
    connect: ({ integrationId, credentials }) =>
      integrationOperations.connect(integrationId, credentials),
    disconnect: ({ integrationId }) => integrationOperations.disconnect(integrationId),
    listAccounts: ({ integrationId }) => integrationOperations.listAccounts(integrationId),
    setDefaultAccount: ({ integrationId, accountId }) =>
      integrationOperations.setDefaultAccount(integrationId, accountId),
    removeAccount: ({ integrationId, accountId }) =>
      integrationOperations.removeAccount(integrationId, accountId),
  });
}
