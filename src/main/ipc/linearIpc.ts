import { ipcMain } from 'electron';
import LinearService from '../services/LinearService';

const linearService = new LinearService();

export function registerLinearIpc() {
  ipcMain.handle('linear:saveToken', async (_event, token: string) => {
    if (!token || typeof token !== 'string') {
      return { success: false, error: 'A Linear API token is required.' };
    }

    return linearService.saveToken(token);
  });

  ipcMain.handle('linear:checkConnection', async () => {
    return linearService.checkConnection();
  });

  ipcMain.handle('linear:clearToken', async () => {
    return linearService.clearToken();
  });

  ipcMain.handle('linear:initialFetch', async (_event, limit?: number) => {
    try {
      const issues = await linearService.initialFetch(
        typeof limit === 'number' && Number.isFinite(limit) ? limit : undefined
      );
      return { success: true, issues };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to fetch initial Linear issues right now.';
      return { success: false, error: message };
    }
  });

  ipcMain.handle('linear:searchIssues', async (_event, searchTerm: string, limit?: number) => {
    if (!searchTerm || typeof searchTerm !== 'string') {
      return { success: false, error: 'Search term is required.' };
    }

    try {
      const issues = await linearService.searchIssues(searchTerm, limit ?? 20);
      return { success: true, issues };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to search Linear issues right now.';
      return { success: false, error: message };
    }
  });
}

export default registerLinearIpc;
