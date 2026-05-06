import { createRPCController } from '@shared/ipc/rpc';
import { plainConnectionService } from './plain-connection-service';

export const plainController = createRPCController({
  saveToken: async (token: string) => {
    if (!token || typeof token !== 'string') {
      return { success: false, error: 'A Plain API key is required.' };
    }
    return plainConnectionService.saveToken(token);
  },

  checkConnection: async () => plainConnectionService.checkConnection(),

  clearToken: async () => plainConnectionService.clearToken(),
});
