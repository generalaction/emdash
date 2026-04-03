import { createRPCController } from '@shared/ipc/rpc';
import { forgejoService } from './forgejo-service';

export const forgejoController = createRPCController({
  saveCredentials: async (creds: { instanceUrl: string; token: string }) => {
    if (!creds.instanceUrl || !creds.token) {
      return { success: false, error: 'Instance URL and API token are required.' };
    }
    return forgejoService.saveCredentials(creds.instanceUrl, creds.token);
  },

  clearCredentials: async () => forgejoService.clearCredentials(),

  checkConnection: async () => forgejoService.checkConnection(),

  initialFetch: async (projectPath: string, limit?: number) => {
    if (!projectPath) {
      return { success: false, error: 'Project path is required.' };
    }

    try {
      const issues = await forgejoService.initialFetch(projectPath, limit);
      return { success: true, issues };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch Forgejo issues.',
      };
    }
  },

  searchIssues: async (projectPath: string, searchTerm: string, limit?: number) => {
    if (!projectPath) {
      return { success: false, error: 'Project path is required.' };
    }

    try {
      const issues = await forgejoService.searchIssues(projectPath, searchTerm, limit);
      return { success: true, issues };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to search Forgejo issues.',
      };
    }
  },
});
