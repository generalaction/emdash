import { createRPCController } from '@shared/lib/ipc/rpc';
import { planeConnectionService, type PlaneCredentials } from './plane-connection-service';

export const planeController = createRPCController({
  saveCredentials: async (credentials: PlaneCredentials) => {
    if (!credentials.apiBaseUrl || !credentials.workspaceSlug || !credentials.token) {
      return { success: false, error: 'API base URL, workspace slug, and API key are required.' };
    }
    return planeConnectionService.saveCredentials(credentials);
  },

  clearCredentials: async () => planeConnectionService.clearCredentials(),

  checkConnection: async () => planeConnectionService.checkConnection(),
});
