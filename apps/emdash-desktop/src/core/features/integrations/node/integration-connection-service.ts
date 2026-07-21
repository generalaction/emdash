import type { IntegrationCredentials } from '@emdash/plugins/integrations';
import { integrationPluginRegistry } from '@emdash/plugins/integrations';
import type { Logger } from '@emdash/shared/logger';
import type { ConnectionStatus } from '@core/primitives/issue-providers/api';
import type { TelemetryService } from '@core/primitives/telemetry/api/telemetry';
import { DEFAULT_INTEGRATION_ACCOUNT_ID } from './integration-credential-store';
import type { IntegrationCredentialStore } from './integration-credential-store';

type ConnectResult =
  | { success: true; displayName?: string; displayDetail?: string }
  | { success: false; error: string };

export class IntegrationConnectionService {
  constructor(
    private readonly credentials: IntegrationCredentialStore,
    private readonly telemetry: TelemetryService,
    private readonly logger: Logger
  ) {}

  async connect(
    integrationId: string,
    credentials: IntegrationCredentials
  ): Promise<ConnectResult> {
    const plugin = integrationPluginRegistry.get(integrationId);
    if (!plugin) return { success: false, error: `Unknown integration: ${integrationId}` };

    const result = await plugin.behavior.auth?.verify({ log: this.logger }, credentials);
    if (!result?.connected) {
      return {
        success: false,
        error: result?.error ?? `Failed to connect ${plugin.metadata.name}.`,
      };
    }

    await this.credentials.upsertAccount(integrationId, {
      accountId: result.account
        ? `${result.account.host ?? integrationId}:${result.account.id}`
        : DEFAULT_INTEGRATION_ACCOUNT_ID,
      ...(result.displayName ? { displayName: result.displayName } : {}),
      credentials: result.credentials ?? credentials,
    });
    this.telemetry.capture('integration_connected', { provider: integrationId });

    return {
      success: true,
      displayName: result.displayName,
      displayDetail: result.displayDetail,
    };
  }

  async disconnect(integrationId: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.credentials.delete(integrationId);
      this.telemetry.capture('integration_disconnected', { provider: integrationId });
      return { success: true };
    } catch (error) {
      this.logger.error('Failed to disconnect integration', { integrationId, error });
      return { success: false, error: 'Unable to remove credentials from secure storage.' };
    }
  }

  async checkConnection(
    integrationId: string,
    capabilities: ConnectionStatus['capabilities'],
    accountId?: string
  ): Promise<ConnectionStatus> {
    const plugin = integrationPluginRegistry.get(integrationId);
    if (!plugin) {
      return {
        connected: false,
        error: `Unknown integration: ${integrationId}`,
        capabilities,
      };
    }

    const account = await this.credentials.getAccount(integrationId, accountId);
    if (!account) return { connected: false, capabilities };

    try {
      const result = await plugin.behavior.auth?.verify({ log: this.logger }, account.credentials);
      if (!result?.connected) {
        return { connected: false, error: result?.error, capabilities };
      }
      if (result.credentials) {
        await this.credentials.upsertAccount(integrationId, {
          ...account,
          credentials: result.credentials,
        });
      }
      return {
        connected: true,
        displayName: result.displayName,
        displayDetail: result.displayDetail,
        capabilities,
      };
    } catch (error) {
      return {
        connected: false,
        error: error instanceof Error ? error.message : 'Connection check failed.',
        capabilities,
      };
    }
  }
}

let integrationConnectionService: IntegrationConnectionService | undefined;

export function setIntegrationConnectionService(service: IntegrationConnectionService): void {
  integrationConnectionService = service;
}

export function getIntegrationConnectionService(): IntegrationConnectionService {
  if (!integrationConnectionService) {
    throw new Error('Integration connection service has not been configured');
  }
  return integrationConnectionService;
}
