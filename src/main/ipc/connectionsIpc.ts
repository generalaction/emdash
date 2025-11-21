import { ipcMain } from 'electron';
import { connectionsService } from '../services/ConnectionsService';

export function registerConnectionsIpc() {
  ipcMain.handle('providers:getStatuses', async (_event, opts?: { refresh?: boolean }) => {
    try {
      if (opts?.refresh) {
        await connectionsService.refreshAllProviderStatuses();
      }
      const statuses = connectionsService.getCachedProviderStatuses();
      return { success: true, statuses };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
}
