import { createRPCController } from '@shared/ipc/rpc';
import { jiraConnectionService } from './jira-connection-service';

export const jiraController = createRPCController({
  saveCredentials: async (args: { siteUrl: string; email: string; token: string }) => {
    const siteUrl = String(args?.siteUrl || '').trim();
    const email = String(args?.email || '').trim();
    const token = String(args?.token || '').trim();
    if (!siteUrl || !email || !token) {
      return { success: false, error: 'Site URL, email, and API token are required.' };
    }

    return jiraConnectionService.saveCredentials(siteUrl, email, token);
  },

  clearCredentials: async () => jiraConnectionService.clearCredentials(),

  checkConnection: async () => jiraConnectionService.checkConnection(),
});
