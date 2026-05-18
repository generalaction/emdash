import { createRPCController } from '@shared/ipc/rpc';
import { asanaConnectionService } from './asana-connection-service';

export const asanaController = createRPCController({
  saveToken: async (token: string) => {
    if (!token || typeof token !== 'string') {
      return { success: false, error: 'An Asana access token is required.' };
    }
    return asanaConnectionService.saveToken(token);
  },

  checkConnection: async () => asanaConnectionService.checkConnection(),

  clearToken: async () => asanaConnectionService.clearToken(),
});
