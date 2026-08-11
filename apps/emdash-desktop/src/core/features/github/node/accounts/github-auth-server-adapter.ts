import type {
  ProviderTokenDispatchResult,
  ProviderTokenPayload,
} from '@core/features/account/api/node/provider-token-registry';
import { upsertGitHubAccount, type GitHubAccountStore } from './github-accounts';

export class GitHubAuthServerAdapter {
  constructor(private readonly accountStore: Pick<GitHubAccountStore, 'upsertAccount'>) {}

  async storeOAuthToken(
    payload: ProviderTokenPayload
  ): Promise<ProviderTokenDispatchResult | void> {
    if (!payload.providerAccount) {
      return;
    }

    if (payload.providerAccount.providerId !== 'github') {
      return;
    }

    const result = await upsertGitHubAccount(this.accountStore, {
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
