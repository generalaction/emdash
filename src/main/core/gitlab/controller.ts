import { createRPCController } from '@shared/ipc/rpc';
import { gitlabService } from './gitlab-service';

export const gitlabController = createRPCController({
  saveCredentials: async (creds: { instanceUrl: string; token: string }) => {
    if (!creds.instanceUrl || !creds.token) {
      return { success: false, error: 'Instance URL and API token are required.' };
    }
    return gitlabService.saveCredentials(creds.instanceUrl, creds.token);
  },

  clearCredentials: async () => gitlabService.clearCredentials(),

  checkConnection: async () => gitlabService.checkConnection(),

  initialFetch: async (projectPath: string, limit?: number) => {
    if (!projectPath) {
      return { success: false, error: 'Project path is required.' };
    }

    try {
      const issues = await gitlabService.initialFetch(projectPath, limit);
      return { success: true, issues };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch GitLab issues.',
      };
    }
  },

  searchIssues: async (projectPath: string, searchTerm: string, limit?: number) => {
    if (!projectPath) {
      return { success: false, error: 'Project path is required.' };
    }

    try {
      const issues = await gitlabService.searchIssues(projectPath, searchTerm, limit);
      return { success: true, issues };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to search GitLab issues.',
      };
    }
  },
});
