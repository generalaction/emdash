import { createRPCController } from '@shared/ipc/rpc';
import { featurebaseConnectionService } from './featurebase-connection-service';

export const featurebaseController = createRPCController({
  saveToken: async (token: string) => {
    if (!token || typeof token !== 'string') {
      return { success: false, error: 'A Featurebase API key is required.' };
    }
    return featurebaseConnectionService.saveToken(token);
  },

  checkConnection: async () => featurebaseConnectionService.checkConnection(),

  clearToken: async () => featurebaseConnectionService.clearToken(),
});
