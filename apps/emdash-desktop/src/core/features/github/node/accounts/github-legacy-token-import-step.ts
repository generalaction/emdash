import { gitHubCredentialsSchema } from '@emdash/plugins/integrations/github';
import type { GitHubTokenSource, GitHubUser } from '@core/primitives/github/api';
import type { LegacyAccountImports } from '@core/services/provider-accounts/node/migrations/legacy-account-imports';

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

/** GitHub's migration adapter: resolve the old token's identity before importing it. */
export class GitHubLegacyTokenImportStep {
  constructor(
    private readonly imports: LegacyAccountImports,
    private readonly legacyTokenStore: LegacyGitHubTokenMigrationStore,
    private readonly identityClient: GitHubIdentityClient
  ) {}

  run(): Promise<'complete' | 'retry'> {
    return this.imports.run(
      'github-legacy-token-import:completedAt',
      async (store) => {
        const tokenRecord = await this.legacyTokenStore.getStoredTokenRecord();
        if (!tokenRecord) return 'complete';
        const user = await this.identityClient.getAuthenticatedUser(
          tokenRecord.token,
          'github.com'
        );
        if (!user) return 'retry';
        const identity = providerAccountFromUser(user);
        await store.upsertAccount({
          providerId: 'github',
          accountId: `${identity.host}:${identity.providerAccountId}`,
          secret: JSON.stringify(gitHubCredentialsSchema.parse({ accessToken: tokenRecord.token })),
          meta: {
            providerAccountId: identity.providerAccountId,
            host: identity.host,
            identityScope: identity.host,
            login: identity.login,
            avatarUrl: identity.avatarUrl,
            credentialSource: credentialSource(tokenRecord.source),
          },
        });
        return 'cleanup';
      },
      () => this.legacyTokenStore.clearStoredToken()
    );
  }
}
