import type { ProviderTokenPayload } from '@main/core/account/provider-token-registry';
import type { GitHubConnectionService } from '../services/github-connection-service';
import type { GitHubAccountRegistry } from './github-account-registry';

type LegacyGitHubTokenStore = Pick<GitHubConnectionService, 'storeToken'>;

export class GitHubAuthServerAdapter {
  constructor(
    private readonly accountRegistry: GitHubAccountRegistry,
    private readonly legacyTokenStore: LegacyGitHubTokenStore
  ) {}

  async storeOAuthToken(payload: ProviderTokenPayload): Promise<void> {
    if (payload.intent !== 'account-link') {
      await this.legacyTokenStore.storeToken(payload.accessToken, 'emdash_oauth');
    }

    if (!payload.providerAccount) {
      return;
    }

    if (payload.providerAccount.providerId !== 'github') {
      return;
    }

    await this.accountRegistry.upsertAccount({
      accessToken: payload.accessToken,
      credentialSource: 'emdash_oauth',
      providerAccount: {
        providerId: 'github',
        providerAccountId: payload.providerAccount.providerAccountId,
        host: payload.providerAccount.host,
        login: payload.providerAccount.login,
        avatarUrl: payload.providerAccount.avatarUrl,
      },
    });
  }
}
