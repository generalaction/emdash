import { createRPCController } from '@shared/ipc/rpc';
import { linearConnectionService } from './linear-connection-service';

export const linearController = createRPCController({
  saveToken: async (token: string) => {
    if (!token || typeof token !== 'string') {
      return { success: false, error: 'A Linear API token is required.' };
    }
    return linearConnectionService.saveToken(token);
  },

  checkConnection: async () => linearConnectionService.checkConnection(),

  clearToken: async () => linearConnectionService.clearToken(),
});
