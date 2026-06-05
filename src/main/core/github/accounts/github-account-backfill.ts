import type { GitHubTokenSource, GitHubUser } from '@shared/github';
import type { GitHubConnectionService } from '../services/github-connection-service';
import type { GitHubAccount, GitHubAccountRegistry } from './github-account-registry';

type LegacyGitHubConnection = Pick<GitHubConnectionService, 'getStoredTokenRecord' | 'getUserInfo'>;

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
    private readonly legacyConnection: LegacyGitHubConnection
  ) {}

  async backfillLegacyToken(): Promise<GitHubAccount | null> {
    const tokenRecord = await this.legacyConnection.getStoredTokenRecord();
    if (!tokenRecord) return null;

    const user = await this.legacyConnection.getUserInfo(tokenRecord.token, 'github.com');
    if (!user) return null;

    return this.accountRegistry.upsertAccount({
      accessToken: tokenRecord.token,
      credentialSource: credentialSource(tokenRecord.source),
      providerAccount: providerAccountFromUser(user),
    });
  }
}
