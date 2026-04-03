import { createRPCController } from '@shared/ipc/rpc';
import { plainService } from './plain-service';

export const plainController = createRPCController({
  saveToken: async (token: string) => {
    if (!token || typeof token !== 'string') {
      return { success: false, error: 'A Plain API key is required.' };
    }
    return plainService.saveToken(token);
  },

  checkConnection: async () => plainService.checkConnection(),

  clearToken: async () => plainService.clearToken(),

  initialFetch: async (limit?: number) => {
    try {
      const threads = await plainService.initialFetch(
        typeof limit === 'number' && Number.isFinite(limit) ? limit : undefined
      );
      return { success: true, issues: threads };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to fetch Plain threads right now.';
      return { success: false, error: message };
    }
  },

  searchIssues: async (searchTerm: string, limit?: number) => {
    if (!searchTerm || typeof searchTerm !== 'string') {
      return { success: false, error: 'Search term is required.' };
    }
    try {
      const threads = await plainService.searchThreads(searchTerm, limit ?? 20);
      return { success: true, issues: threads };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to search Plain threads right now.';
      return { success: false, error: message };
    }
  },
});
