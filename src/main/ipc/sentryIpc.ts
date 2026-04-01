import { ipcMain } from 'electron';
import { sentryService } from '../services/SentryService';

export function registerSentryIpc() {
  ipcMain.handle('sentry:saveToken', async (_event, token: string, organizationSlug?: string) => {
    if (!token || typeof token !== 'string') {
      return { success: false, error: 'A Sentry auth token is required.' };
    }

    return sentryService.saveToken(token, organizationSlug);
  });

  ipcMain.handle('sentry:checkConnection', async () => {
    return sentryService.checkConnection();
  });

  ipcMain.handle('sentry:clearToken', async () => {
    return sentryService.clearToken();
  });

  ipcMain.handle('sentry:initialFetch', async (_event, limit?: number) => {
    try {
      const issues = await sentryService.initialFetch(
        typeof limit === 'number' && Number.isFinite(limit) ? limit : undefined
      );
      return { success: true, issues };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to fetch Sentry issues right now.';
      return { success: false, error: message };
    }
  });

  ipcMain.handle('sentry:searchIssues', async (_event, searchTerm: string, limit?: number) => {
    if (!searchTerm || typeof searchTerm !== 'string') {
      return { success: false, error: 'Search term is required.' };
    }

    try {
      const issues = await sentryService.searchIssues(searchTerm, limit ?? 25);
      return { success: true, issues };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to search Sentry issues right now.';
      return { success: false, error: message };
    }
  });
}

export default registerSentryIpc;
