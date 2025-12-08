import { ipcMain } from 'electron';
import { connectionsService } from '../services/ConnectionsService';

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
}
