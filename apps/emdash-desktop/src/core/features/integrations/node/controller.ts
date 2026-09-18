import type { IntegrationCredentials } from '@emdash/plugins/integrations';
import { integrationPluginRegistry } from '@emdash/plugins/integrations';
import { log } from '@emdash/shared/logger';
import type { ProviderAccountsByProvider } from '@core/primitives/provider-accounts/api';
import { getProviderAccountService } from '@core/services/provider-accounts/node/provider-account-service';
import type { IntegrationConnectOptions } from '../api/contract';
import { getIntegrationConnectionService } from './integration-connection-service';
import { buildIntegrationProviderDescriptors } from './integration-payload-builder';

export const integrationOperations = {
  listProviders: async () => buildIntegrationProviderDescriptors(),

  listAccounts: async (): Promise<ProviderAccountsByProvider> => {
    const service = getProviderAccountService();
    const entries = await Promise.all(
      integrationPluginRegistry.getAll().map(async (plugin) => {
        const integrationId = plugin.metadata.id;
        return [integrationId, await service.listAccounts(integrationId)] as const;
      })
    );
    return Object.fromEntries(entries.filter(([, accounts]) => accounts.length > 0));
  },

  connect: async (
    integrationId: string,
    credentials: IntegrationCredentials,
    options?: IntegrationConnectOptions
  ) => {
    const plugin = integrationPluginRegistry.get(integrationId);
    if (!plugin?.capabilities.auth.methods.some((method) => method.kind === 'form')) {
      return { success: false as const, error: 'Use this integration’s sign-in flow to connect.' };
    }
    return getIntegrationConnectionService().connect(integrationId, credentials, options);
  },

  disconnect: async (integrationId: string, accountId: string) => {
    try {
      const service = getProviderAccountService();
      await service.removeAccount(integrationId, accountId);
      return { success: true };
    } catch (error) {
      log.error('Failed to remove integration account', { integrationId, accountId, error });
      return { success: false, error: 'Unable to remove credentials from secure storage.' };
    }
  },

  setDefaultAccount: async (integrationId: string, accountId: string) => {
    try {
      const account = await getProviderAccountService().setDefaultAccount(integrationId, accountId);
      if (!account) return { success: false, error: 'Account not found.' };
      return { success: true };
    } catch (error) {
      log.error('Failed to set default integration account', { integrationId, accountId, error });
      return { success: false, error: 'Unable to update the default account.' };
    }
  },
};
