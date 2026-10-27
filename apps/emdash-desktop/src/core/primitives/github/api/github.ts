import type { ProviderAccountSummary } from '@core/primitives/provider-accounts/api';

export interface GitHubUser {
  id: number;
  login: string;
  name: string;
  email: string;
  avatar_url: string;
}

export type GitHubTokenSource = 'secure_storage' | 'cli' | 'emdash_oauth' | 'device_flow' | null;

export type GitHubCredentialSource = Exclude<GitHubTokenSource, null>;

/** The shared account summary with the identity fields required by GitHub operations. */
export type GitHubAccountSummary = ProviderAccountSummary & {
  providerId: 'github';
  host: string;
  login: string;
  avatarUrl: string;
  credentialSource: GitHubCredentialSource;
};

export function isGitHubAccountSummary(
  account: ProviderAccountSummary
): account is GitHubAccountSummary {
  return (
    account.providerId === 'github' &&
    typeof account.host === 'string' &&
    typeof account.login === 'string' &&
    typeof account.avatarUrl === 'string' &&
    (account.credentialSource === 'cli' ||
      account.credentialSource === 'emdash_oauth' ||
      account.credentialSource === 'device_flow' ||
      account.credentialSource === 'secure_storage')
  );
}

export type GitHubImportCliAccountsResponse =
  | { success: true; importedAccountIds: string[] }
  | { success: false; error: string };

export interface GitHubOwner {
  login: string;
  type: 'User' | 'Organization';
  avatarUrl: string;
}
