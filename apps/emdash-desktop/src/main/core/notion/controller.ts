import { createRPCController } from '@shared/lib/ipc/rpc';
import { notionConnectionService } from './notion-connection-service';

export const notionController = createRPCController({
  saveCredentials: async (input: { token: string; databaseUrls: string }) => {
    if (
      !input?.token ||
      typeof input.token !== 'string' ||
      typeof input.databaseUrls !== 'string'
    ) {
      return { success: false, error: 'A Notion token and database URLs are required.' };
    }
    return notionConnectionService.saveCredentials(input);
  },

  checkConnection: async () => notionConnectionService.checkConnection(),

  clearCredentials: async () => notionConnectionService.clearCredentials(),
});
