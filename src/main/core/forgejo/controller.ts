import { createRPCController } from '@shared/ipc/rpc';
import { forgejoConnectionService } from './forgejo-connection-service';

export const forgejoController = createRPCController({
  saveCredentials: async (creds: { instanceUrl: string; token: string }) => {
    if (!creds.instanceUrl || !creds.token) {
      return { success: false, error: 'Instance URL and API token are required.' };
    }
    return forgejoConnectionService.saveCredentials(creds.instanceUrl, creds.token);
  },

  clearCredentials: async () => forgejoConnectionService.clearCredentials(),

  checkConnection: async () => forgejoConnectionService.checkConnection(),
});
