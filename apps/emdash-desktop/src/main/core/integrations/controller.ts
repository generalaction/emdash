import type { IntegrationCredentials } from '@emdash/plugins/integrations';
import { integrationConnectionService } from './integration-connection-service';
import { buildIntegrationListPayload } from './integration-payload-builder';

export const integrationOperations = {
  list: async () => buildIntegrationListPayload(),

  connect: async (integrationId: string, credentials: IntegrationCredentials) =>
    integrationConnectionService.connect(integrationId, credentials),

  disconnect: async (integrationId: string) =>
    integrationConnectionService.disconnect(integrationId),
};
