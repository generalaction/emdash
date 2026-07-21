import type { IntegrationCredentials } from '@emdash/plugins/integrations';
import { getIntegrationConnectionService } from './integration-connection-service';
import { buildIntegrationListPayload } from './integration-payload-builder';

export const integrationOperations = {
  list: async () => buildIntegrationListPayload(),

  connect: async (integrationId: string, credentials: IntegrationCredentials) =>
    getIntegrationConnectionService().connect(integrationId, credentials),

  disconnect: async (integrationId: string) =>
    getIntegrationConnectionService().disconnect(integrationId),
};
