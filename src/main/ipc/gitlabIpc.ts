import { ipcMain } from 'electron';
import { gitlabService } from '../services/GitLabService';
import { log } from '../lib/logger';

export function registerGitlabIpc() {
  ipcMain.handle(
    'gitlab:saveCredentials',
    async (_e, args: { instanceUrl: string; token: string }) => {
      const instanceUrl = String(args?.instanceUrl || '').trim();
      const token = String(args?.token || '').trim();
      if (!instanceUrl || !token) {
        return { success: false, error: 'Instance URL and API token are required.' };
      }
      try {
        return await gitlabService.saveCredentials(instanceUrl, token);
      } catch (error) {
        log.error('GitLab saveCredentials failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to save GitLab credentials',
        };
      }
    }
  );

  ipcMain.handle('gitlab:clearCredentials', async () => {
    try {
      return await gitlabService.clearCredentials();
    } catch (error) {
      log.error('GitLab clearCredentials failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to clear GitLab credentials',
      };
    }
  });

  ipcMain.handle('gitlab:checkConnection', async () => {
    try {
      return await gitlabService.checkConnection();
    } catch (error) {
      log.error('GitLab checkConnection failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to check GitLab connection',
      };
    }
  });

  ipcMain.handle(
    'gitlab:initialFetch',
    async (_e, args: { projectPath?: string; limit?: number }) => {
      const projectPath = args?.projectPath;
      const limit =
        typeof args?.limit === 'number' && Number.isFinite(args.limit)
          ? Math.max(1, Math.min(args.limit, 100))
          : 50;
      try {
        return await gitlabService.initialFetch(projectPath, limit);
      } catch (error) {
        log.error('GitLab initialFetch failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to fetch GitLab issues',
        };
      }
    }
  );

  ipcMain.handle(
    'gitlab:searchIssues',
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
        return await gitlabService.searchIssues(projectPath, searchTerm, limit);
      } catch (error) {
        log.error('GitLab searchIssues failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to search GitLab issues',
        };
      }
    }
  );
}

export default registerGitlabIpc;
