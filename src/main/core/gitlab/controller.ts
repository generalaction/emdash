import { createRPCController } from '@shared/ipc/rpc';
import { gitLabConnectionService } from './gitlab-connection-service';

export const gitlabController = createRPCController({
  saveCredentials: async (creds: { instanceUrl: string; token: string }) => {
    if (!creds.instanceUrl || !creds.token) {
      return { success: false, error: 'Instance URL and API token are required.' };
    }
    return gitLabConnectionService.saveCredentials(creds.instanceUrl, creds.token);
  },

  clearCredentials: async () => gitLabConnectionService.clearCredentials(),

  checkConnection: async () => gitLabConnectionService.checkConnection(),
});
