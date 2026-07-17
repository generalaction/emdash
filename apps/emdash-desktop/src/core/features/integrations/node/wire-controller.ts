import { createController, type Controller } from '@emdash/wire/api';
import { integrationOperations } from '@main/core/integrations/controller';
import { integrationsContract } from '../api';

export function createIntegrationsWireController(): Controller {
  return createController(integrationsContract, {
    list: () => integrationOperations.list(),
    connect: ({ integrationId, credentials }) =>
      integrationOperations.connect(integrationId, credentials),
    disconnect: ({ integrationId }) => integrationOperations.disconnect(integrationId),
  });
}
