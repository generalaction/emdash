import { gitCredentialChannelsContract } from '@emdash/core/services/git-credential-channels/api';
import { createController, type Controller } from '@emdash/wire/rpc';
import type { GitCredentialChannelServer } from '@core/features/github/api/node/services/git-credentials-service';

let boundChannels: Pick<GitCredentialChannelServer, 'revokeSession'> | undefined;

/** Binds the credential server during services boot; workers spawn before it exists. */
export function bindGitCredentialChannels(
  channels: Pick<GitCredentialChannelServer, 'revokeSession'>
): void {
  boundChannels = channels;
}

/**
 * Desktop answer to session runtimes releasing the Git credential channels they were
 * handed (spec: github-git-settings §4). Before the server is bound no channel exists,
 * so there is nothing to release.
 */
export function createGitCredentialChannelsController(): Controller {
  return createController(gitCredentialChannelsContract, {
    release: async ({ nonce }) => {
      boundChannels?.revokeSession(nonce);
    },
  });
}
