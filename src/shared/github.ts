export interface GitHubUser {
  id: number;
  login: string;
  name: string;
  email: string;
  avatar_url: string;
}

export type GitHubTokenSource = 'secure_storage' | 'cli' | 'emdash_oauth' | 'device_flow' | null;

export type GitHubCredentialSource = Exclude<GitHubTokenSource, null>;

export interface GitHubAccountSummary {
  accountId: string;
  host: string;
  login: string;
  avatarUrl: string;
  credentialSource: GitHubCredentialSource;
  isDefault: boolean;
}

export type GitHubSetDefaultAccountResponse =
  | { success: true; account: GitHubAccountSummary }
  | { success: false; error: string };

export type GitHubImportCliAccountsResponse =
  | { success: true; accounts: GitHubAccountSummary[]; importedAccountIds: string[] }
  | { success: false; error: string };

export type GitHubRemoveAccountResponse =
  | { success: true; accounts: GitHubAccountSummary[] }
  | { success: false; error: string };

export interface GitHubStatusResponse {
  authenticated: boolean;
  user: GitHubUser | null;
  tokenSource: GitHubTokenSource;
}

export interface GitHubStatusOptions {
  refresh?: boolean;
}

export type GitHubAuthResponse =
  | { success: true; account: GitHubAccountSummary }
  | { success: false; error: string };

export interface GitHubConnectResponse {
  success: boolean;
  token?: string;
  user?: GitHubUser;
  error?: string;
}
