import type { GitHubTokenSource, GitHubUser } from '@shared/github';
import type { GitHubAccount, GitHubAccountRegistry } from './github-account-registry';

type LegacyGitHubTokenMigrationStore = {
  getStoredTokenRecord(): Promise<{
    token: string;
    source: Exclude<GitHubTokenSource, null> | null;
  } | null>;
  clearStoredToken(): Promise<void>;
};

type GitHubIdentityClient = {
  getAuthenticatedUser(token: string, host?: string): Promise<GitHubUser | null>;
};

function credentialSource(source: GitHubTokenSource) {
  return source ?? 'secure_storage';
}

function providerAccountFromUser(user: GitHubUser) {
  return {
    providerId: 'github' as const,
    providerAccountId: String(user.id),
    host: 'github.com',
    login: user.login,
    avatarUrl: user.avatar_url,
  };
}

export class GitHubAccountBackfillService {
  constructor(
    private readonly accountRegistry: GitHubAccountRegistry,
    private readonly legacyTokenStore: LegacyGitHubTokenMigrationStore,
    private readonly identityClient: GitHubIdentityClient
  ) {}

  async backfillLegacyToken(): Promise<GitHubAccount | null> {
    const tokenRecord = await this.legacyTokenStore.getStoredTokenRecord();
    if (!tokenRecord) return null;

    const user = await this.identityClient.getAuthenticatedUser(tokenRecord.token, 'github.com');
    if (!user) return null;

    const account = await this.accountRegistry.upsertAccount({
      accessToken: tokenRecord.token,
      credentialSource: credentialSource(tokenRecord.source),
      providerAccount: providerAccountFromUser(user),
    });
    await this.legacyTokenStore.clearStoredToken();
    return account;
  }
}
