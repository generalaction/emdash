import { ipcMain } from 'electron';
import { forgejoService } from '../services/ForgejoService';
import { log } from '../lib/logger';

export function registerForgejoIpc() {
  ipcMain.handle(
    'forgejo:saveCredentials',
    async (_e, args: { instanceUrl: string; token: string }) => {
      const instanceUrl = String(args?.instanceUrl || '').trim();
      const token = String(args?.token || '').trim();
      if (!instanceUrl || !token) {
        return { success: false, error: 'Instance URL and API token are required.' };
      }
      try {
        return await forgejoService.saveCredentials(instanceUrl, token);
      } catch (error) {
        log.error('Forgejo saveCredentials failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to save Forgejo credentials',
        };
      }
    }
  );

  ipcMain.handle('forgejo:clearCredentials', async () => {
    try {
      return await forgejoService.clearCredentials();
    } catch (error) {
      log.error('Forgejo clearCredentials failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to clear Forgejo credentials',
      };
    }
  });

  ipcMain.handle('forgejo:checkConnection', async () => {
    try {
      return await forgejoService.checkConnection();
    } catch (error) {
      log.error('Forgejo checkConnection failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to check Forgejo connection',
      };
    }
  });

  ipcMain.handle(
    'forgejo:initialFetch',
    async (_e, args: { projectPath?: string; limit?: number }) => {
      const projectPath = args?.projectPath;
      const limit =
        typeof args?.limit === 'number' && Number.isFinite(args.limit)
          ? Math.max(1, Math.min(args.limit, 100))
          : 50;
      try {
        return await forgejoService.initialFetch(projectPath, limit);
      } catch (error) {
        log.error('Forgejo initialFetch failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to fetch Forgejo issues',
        };
      }
    }
  );

  ipcMain.handle(
    'forgejo:searchIssues',
    async (_e, args: { projectPath?: string; searchTerm: string; limit?: number }) => {
      const searchTerm = String(args?.searchTerm || '').trim();
      if (!searchTerm) {
        return { success: true, issues: [] };
      }
      const projectPath = args?.projectPath;
      const limit =
        typeof args?.limit === 'number' && Number.isFinite(args.limit)
          ? Math.max(1, Math.min(args.limit, 100))
          : 20;
      try {
        return await forgejoService.searchIssues(projectPath, searchTerm, limit);
      } catch (error) {
        log.error('Forgejo searchIssues failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to search Forgejo issues',
        };
      }
    }
  );
}

export default registerForgejoIpc;
