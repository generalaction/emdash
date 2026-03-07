import { connectionsService } from '../services/ConnectionsService';
import {
  getProviderCustomConfig,
  getAllProviderCustomConfigs,
  updateProviderCustomConfig,
  type ProviderCustomConfig,
} from '../../_new/core/settings';
import { createRPCController } from '../../../shared/ipc/rpc';

export const connectionsController = createRPCController({
  getStatuses: async (opts?: { refresh?: boolean; providers?: string[]; providerId?: string }) => {
    const providers =
      Array.isArray(opts?.providers) && opts.providers.length > 0
        ? opts.providers
        : opts?.providerId
          ? [opts.providerId]
          : null;

    try {
      if (opts?.refresh) {
        if (providers && providers.length > 0) {
          for (const id of providers) {
            await connectionsService.checkProvider(id, 'manual');
          }
        } else {
          await connectionsService.refreshAllProviderStatuses();
        }
      }
      const statuses = connectionsService.getCachedProviderStatuses();
      return { success: true, statuses };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },

  getCustomConfig: (providerId: string) => {
    try {
      const config = getProviderCustomConfig(providerId);
      return { success: true, config };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },

  getAllCustomConfigs: () => {
    try {
      const configs = getAllProviderCustomConfigs();
      return { success: true, configs };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },

  updateCustomConfig: (providerId: string, config: ProviderCustomConfig | undefined) => {
    try {
      updateProviderCustomConfig(providerId, config);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});
