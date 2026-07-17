import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { KV } from '@main/db/kv';
import type { GitHubTokenSource } from '@shared/github';
import { LegacyGitHubTokenMigrationStore } from './legacy-github-token-migration-store';

type LegacyTokenSource = Exclude<GitHubTokenSource, null>;

interface GitHubKVSchema extends Record<string, unknown> {
  tokenSource: LegacyTokenSource;
}

const githubKV = new KV<GitHubKVSchema>('github');

export const legacyGitHubTokenMigrationStore = new LegacyGitHubTokenMigrationStore(
  encryptedAppSecretsStore,
  {
    getTokenSource: () => githubKV.get('tokenSource'),
    clearTokenSource: () => githubKV.del('tokenSource'),
  }
);
