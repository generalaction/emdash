import { createController, type Controller } from '@emdash/wire/rpc';
import { integrationOperations } from '@core/features/integrations/node/controller';
import { integrationsContract } from '../api';
import { integrationsEvents } from './event-host';

export function createIntegrationsWireController(): Controller {
  return createController(integrationsContract, {
    listProviders: () => integrationOperations.listProviders(),
    listAccounts: () => integrationOperations.listAccounts(),
    connect: ({ integrationId, credentials, accountId, displayName }) =>
      integrationOperations.connect(integrationId, credentials, { accountId, displayName }),
    disconnect: ({ integrationId, accountId }) =>
      integrationOperations.disconnect(integrationId, accountId),
    setDefaultAccount: ({ integrationId, accountId }) =>
      integrationOperations.setDefaultAccount(integrationId, accountId),
    events: integrationsEvents,
  });
}
