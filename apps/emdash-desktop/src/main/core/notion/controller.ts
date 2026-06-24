import { createRPCController } from '@shared/lib/ipc/rpc';
import { notionConnectionService } from './notion-connection-service';

export const notionController = createRPCController({
  saveCredentials: async (input: {
    token?: string;
    databaseUrls: string;
    preserveToken?: boolean;
  }) => {
    if (
      !input ||
      (input.token !== undefined && typeof input.token !== 'string') ||
      typeof input.databaseUrls !== 'string' ||
      (input.preserveToken !== undefined && typeof input.preserveToken !== 'boolean')
    ) {
      return { success: false, error: 'A Notion access token and scope URLs are required.' };
    }
    return notionConnectionService.saveCredentials(input);
  },

  getConfiguration: async () => notionConnectionService.getConfiguration(),

  checkConnection: async () => notionConnectionService.checkConnection(),

  clearCredentials: async () => notionConnectionService.clearCredentials(),
});
