import { ipcMain } from 'electron';
import JiraService from '../services/JiraService';

const jira = new JiraService();

export function registerJiraIpc() {
  ipcMain.handle(
    'jira:saveCredentials',
    async (
      _e,
      args: { siteUrl: string; email?: string; token: string; authType?: 'basic' | 'bearer' }
    ) => {
      const siteUrl = String(args?.siteUrl || '').trim();
      const token = String(args?.token || '').trim();
      const authType = args?.authType === 'bearer' ? 'bearer' : 'basic';
      const email = String(args?.email || '').trim();

      if (!siteUrl || !token) {
        return { success: false, error: 'Site URL and token are required.' };
      }
      if (authType === 'basic' && !email) {
        return { success: false, error: 'Email is required for API token auth.' };
      }
      return jira.saveCredentials(siteUrl, token, authType, email || undefined);
    }
  );

  ipcMain.handle('jira:clearCredentials', async () => jira.clearCredentials());
  ipcMain.handle('jira:checkConnection', async () => jira.checkConnection());

  ipcMain.handle('jira:initialFetch', async (_e, limit?: number) => {
    try {
      const issues = await jira.initialFetch(
        typeof limit === 'number' && Number.isFinite(limit) ? limit : 50
      );
      return { success: true, issues };
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle('jira:searchIssues', async (_e, searchTerm: string, limit?: number) => {
    try {
      const issues = await jira.smartSearchIssues(searchTerm, limit ?? 20);
      return { success: true, issues };
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) };
    }
  });
}

export default registerJiraIpc;
