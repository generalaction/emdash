import { ipcMain } from 'electron';
import { connectionsService } from '../services/ConnectionsService';
import {
  getProviderCustomConfig,
  getAllProviderCustomConfigs,
  updateProviderCustomConfig,
  type ProviderCustomConfig,
} from '../settings';

export function registerConnectionsIpc() {
  ipcMain.handle(
    'providers:getStatuses',
    async (_event, opts?: { refresh?: boolean; providers?: string[]; providerId?: string }) => {
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
    }
  );

  // Get custom config for a specific provider
  ipcMain.handle('providers:getCustomConfig', (_event, providerId: string) => {
    try {
      const config = getProviderCustomConfig(providerId);
      return { success: true, config };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Get all custom configs
  ipcMain.handle('providers:getAllCustomConfigs', () => {
    try {
      const configs = getAllProviderCustomConfigs();
      return { success: true, configs };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Update custom config for a specific provider
  ipcMain.handle(
    'providers:updateCustomConfig',
    (_event, providerId: string, config: ProviderCustomConfig | undefined) => {
      try {
        updateProviderCustomConfig(providerId, config);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );
}
