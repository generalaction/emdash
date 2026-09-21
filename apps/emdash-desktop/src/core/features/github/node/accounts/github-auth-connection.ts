import type { IntegrationConnections } from '@core/features/integrations/api/node/integration-accounts';
import {
  isGitHubAccountSummary,
  type GitHubAccountSummary,
  type GitHubCredentialSource,
} from '@core/primitives/github/api/github';
import { type ProviderAccountIdentity } from '@core/primitives/provider-accounts/api';
import { normalizeRepositoryHost } from '@core/primitives/repository/api';
import { githubApiBaseUrlForHost } from '../../api/node/services/github-api-base-url';

export const GITHUB_PROVIDER_ID = 'github';

export type GitHubProviderAccount = ProviderAccountIdentity & { providerId: 'github' };

export type GitHubConnectionInput = {
  accessToken: string;
  credentialSource: GitHubCredentialSource;
  providerAccount: GitHubProviderAccount;
};

export type GitHubConnectionResult = {
  account: GitHubAccountSummary;
  status: 'created' | 'updated';
};

export function normalizeGitHubHost(host: string): string {
  return normalizeRepositoryHost(host) || 'github.com';
}

/** Adapt an authenticated GitHub identity to the shared integration connection lifecycle. */
export async function connectGitHubAccount(
  connections: IntegrationConnections,
  input: GitHubConnectionInput
): Promise<GitHubConnectionResult> {
  const host = normalizeGitHubHost(input.providerAccount.host);
  const result = await connections.connectVerified(
    'github',
    {
      connected: true,
      account: {
        id: input.providerAccount.providerAccountId,
        host,
        login: input.providerAccount.login,
        avatarUrl: input.providerAccount.avatarUrl,
      },
      credentials: {
        accessToken: input.accessToken,
        apiBaseUrl: githubApiBaseUrlForHost(host),
      },
    },
    { credentialSource: input.credentialSource }
  );
  if (!result.success) throw new Error(result.error);
  if (!isGitHubAccountSummary(result.account))
    throw new Error('GitHub account identity is incomplete');
  return { account: result.account, status: result.status };
}
