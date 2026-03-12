import { createRPCController } from '@shared/ipc/rpc';
import { jiraService } from './JiraService';

export const jiraController = createRPCController({
  saveCredentials: async (args: { siteUrl: string; email: string; token: string }) => {
    const siteUrl = String(args?.siteUrl || '').trim();
    const email = String(args?.email || '').trim();
    const token = String(args?.token || '').trim();
    if (!siteUrl || !email || !token) {
      return { success: false, error: 'Site URL, email, and API token are required.' };
    }
    return jiraService.saveCredentials(siteUrl, email, token);
  },

  clearCredentials: async () => jiraService.clearCredentials(),

  checkConnection: async () => jiraService.checkConnection(),

  initialFetch: async (limit?: number) => {
    try {
      const issues = await jiraService.initialFetch(
        typeof limit === 'number' && Number.isFinite(limit) ? limit : 50
      );
      return { success: true, issues };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  searchIssues: async (searchTerm: string, limit?: number) => {
    try {
      const issues = await jiraService.smartSearchIssues(searchTerm, limit ?? 20);
      return { success: true, issues };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
});
