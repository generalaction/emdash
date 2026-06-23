import type {
  ProviderTokenDispatchResult,
  ProviderTokenPayload,
} from '@main/core/account/provider-token-registry';
import type { GitHubAccountRegistry } from './github-account-registry';

export class GitHubAuthServerAdapter {
  constructor(private readonly accountRegistry: GitHubAccountRegistry) {}

  async storeOAuthToken(
    payload: ProviderTokenPayload
  ): Promise<ProviderTokenDispatchResult | void> {
    if (!payload.providerAccount) {
      return;
    }

    if (payload.providerAccount.providerId !== 'github') {
      return;
    }

    const result = await this.accountRegistry.upsertAccount({
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

    return {
      providerAccountStatus: result.status,
      providerAccount: payload.providerAccount,
    };
  }
}
