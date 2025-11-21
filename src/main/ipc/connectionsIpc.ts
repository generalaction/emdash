import { ipcMain } from 'electron';
import { connectionsService } from '../services/ConnectionsService';

export function registerConnectionsIpc() {
  ipcMain.handle('connections:getCliProviders', async () => {
    try {
      const providers = await connectionsService.getCliProviders();
      return { success: true, providers };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle('providers:getStatuses', async () => {
    try {
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
