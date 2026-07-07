import type { IntegrationCredentials } from '@emdash/plugins/integrations';
import { getIssueProvider } from '@main/core/issues/registry';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { integrationConnectionService } from './integration-connection-service';
import { buildIntegrationListPayload } from './integration-payload-builder';

export const integrationsController = createRPCController({
  list: async () => buildIntegrationListPayload(),

  checkConfiguredConnections: async () => {
    const integrations = buildIntegrationListPayload();
    const settled = await Promise.all(
      integrations.map(async (integration) => {
        const issueProvider = getIssueProvider(integration.id);
        const configured = issueProvider?.isConfigured
          ? await issueProvider.isConfigured()
          : await integrationConnectionService.isConfigured(integration.id);
        return [integration.id, configured] as const;
      })
    );

    return Object.fromEntries(settled);
  },

  connect: async (integrationId: string, credentials: IntegrationCredentials) =>
    integrationConnectionService.connect(integrationId, credentials),

  disconnect: async (integrationId: string) =>
    integrationConnectionService.disconnect(integrationId),
});
