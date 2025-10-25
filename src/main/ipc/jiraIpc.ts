import { ipcMain } from 'electron';
import JiraService from '../services/JiraService';

const jira = new JiraService();

export function registerJiraIpc() {
  ipcMain.handle(
    'jira:saveCredentials',
    async (_e, args: { siteUrl: string; email: string; token: string }) => {
      const siteUrl = String(args?.siteUrl || '').trim();
      const email = String(args?.email || '').trim();
      const token = String(args?.token || '').trim();
      if (!siteUrl || !email || !token) {
        return { success: false, error: 'Site URL, email, and API token are required.' };
      }
      return jira.saveCredentials(siteUrl, email, token);
    }
  );

  ipcMain.handle('jira:clearCredentials', async () => jira.clearCredentials());
  ipcMain.handle('jira:checkConnection', async () => jira.checkConnection());
  ipcMain.handle('jira:setProjectKey', async (_e, projectKey: string) =>
    jira.saveProjectKey(projectKey)
  );

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
      const issues = await jira.searchIssues(searchTerm, limit ?? 20);
      return { success: true, issues };
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) };
    }
  });
}

export default registerJiraIpc;
