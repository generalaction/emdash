import type { ProviderTokenPayload } from '@main/core/account/provider-token-registry';
import type { GitHubAccountRegistry } from './github-account-registry';

export class GitHubAuthServerAdapter {
  constructor(private readonly accountRegistry: GitHubAccountRegistry) {}

  async storeOAuthToken(payload: ProviderTokenPayload): Promise<void> {
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
