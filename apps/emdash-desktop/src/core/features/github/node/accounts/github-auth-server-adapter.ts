import type {
  ProviderTokenDispatchResult,
  ProviderTokenPayload,
} from '@core/features/account/api/node/provider-token-registry';
import type { IntegrationConnections } from '@core/features/integrations/api/node/integration-accounts';
import { connectGitHubAccount } from './github-auth-connection';

export class GitHubAuthServerAdapter {
  constructor(private readonly connections: IntegrationConnections) {}

  async storeOAuthToken(
    payload: ProviderTokenPayload
  ): Promise<ProviderTokenDispatchResult | void> {
    if (!payload.providerAccount) {
      return;
    }

    if (payload.providerAccount.providerId !== 'github') {
      return;
    }

    const result = await connectGitHubAccount(this.connections, {
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
