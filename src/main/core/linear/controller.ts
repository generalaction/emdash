import { createRPCController } from '@shared/ipc/rpc';
import { linearService } from './LinearService';

export const linearController = createRPCController({
  saveToken: async (token: string) => {
    if (!token || typeof token !== 'string') {
      return { success: false, error: 'A Linear API token is required.' };
    }
    return linearService.saveToken(token);
  },

  checkConnection: async () => linearService.checkConnection(),

  clearToken: async () => linearService.clearToken(),

  initialFetch: async (limit?: number) => {
    try {
      const issues = await linearService.initialFetch(
        typeof limit === 'number' && Number.isFinite(limit) ? limit : undefined
      );
      return { success: true, issues };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to fetch initial Linear issues right now.';
      return { success: false, error: message };
    }
  },

  searchIssues: async (searchTerm: string, limit?: number) => {
    if (!searchTerm || typeof searchTerm !== 'string') {
      return { success: false, error: 'Search term is required.' };
    }
    try {
      const issues = await linearService.searchIssues(searchTerm, limit ?? 20);
      return { success: true, issues };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to search Linear issues right now.';
      return { success: false, error: message };
    }
  },
});
