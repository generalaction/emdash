import type { IntegrationCredentials } from '@emdash/plugins/integrations';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { integrationConnectionService } from './integration-connection-service';
import { buildIntegrationListPayload } from './integration-payload-builder';

export const integrationsController = createRPCController({
  list: async () => buildIntegrationListPayload(),

  connect: async (integrationId: string, credentials: IntegrationCredentials) =>
    integrationConnectionService.connect(integrationId, credentials),

  disconnect: async (integrationId: string) =>
    integrationConnectionService.disconnect(integrationId),
});
