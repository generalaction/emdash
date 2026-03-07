import { ipcMain } from 'electron';
import PlainService from '../services/PlainService';

const plainService = new PlainService();

export function registerPlainIpc() {
  ipcMain.handle('plain:saveToken', async (_event, token: string) => {
    if (!token || typeof token !== 'string') {
      return { success: false, error: 'A Plain API token is required.' };
    }

    return plainService.saveToken(token);
  });

  ipcMain.handle('plain:checkConnection', async () => {
    return plainService.checkConnection();
  });

  ipcMain.handle('plain:clearToken', async () => {
    return plainService.clearToken();
  });

  ipcMain.handle('plain:initialFetch', async (_event, limit?: number, statuses?: string[]) => {
    try {
      const sanitizedStatuses = Array.isArray(statuses)
        ? statuses.filter((s) => ['TODO', 'DONE', 'SNOOZED'].includes(s))
        : undefined;
      const threads = await plainService.initialFetch(
        typeof limit === 'number' && Number.isFinite(limit) ? limit : undefined,
        sanitizedStatuses && sanitizedStatuses.length > 0 ? sanitizedStatuses : undefined
      );
      return { success: true, threads };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to fetch Plain threads right now.';
      return { success: false, error: message };
    }
  });

  ipcMain.handle('plain:searchThreads', async (_event, searchTerm: string, limit?: number) => {
    if (!searchTerm || typeof searchTerm !== 'string') {
      return { success: false, error: 'Search term is required.' };
    }

    try {
      const threads = await plainService.searchThreads(searchTerm, limit ?? 20);
      return { success: true, threads };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to search Plain threads right now.';
      return { success: false, error: message };
    }
  });
}

export default registerPlainIpc;
