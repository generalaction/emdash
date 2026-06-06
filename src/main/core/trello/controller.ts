import { createRPCController } from '@shared/lib/ipc/rpc';
import { trelloConnectionService } from './trello-connection-service';

export const trelloController = createRPCController({
  saveCredentials: async (input: { apiKey: string; token: string; boardUrls: string }) => {
    if (
      !input?.apiKey ||
      typeof input.apiKey !== 'string' ||
      !input?.token ||
      typeof input.token !== 'string' ||
      typeof input.boardUrls !== 'string'
    ) {
      return { success: false, error: 'A Trello API key, token, and board URLs are required.' };
    }
    return trelloConnectionService.saveCredentials(input);
  },

  checkConnection: async () => trelloConnectionService.checkConnection(),

  clearCredentials: async () => trelloConnectionService.clearCredentials(),
});
