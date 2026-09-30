import { eq } from 'drizzle-orm';
import type { GitHubTokenSource } from '@core/primitives/github/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { kv } from '@core/services/app-db/node/schema';

export const GITHUB_TOKEN_SECRET_KEY = 'emdash-github-token';

type LegacyTokenSource = Exclude<GitHubTokenSource, null>;

type LegacySecretStore = {
  getSecret(key: string): Promise<string | null>;
  deleteSecret(key: string): Promise<void>;
};

function parseTokenSource(raw: unknown): LegacyTokenSource | null {
  return raw === 'cli' ||
    raw === 'secure_storage' ||
    raw === 'emdash_oauth' ||
    raw === 'device_flow'
    ? raw
    : null;
}

export class LegacyGitHubTokenMigrationStore {
  constructor(
    private readonly db: AppDb,
    private readonly secretStore: LegacySecretStore
  ) {}

  async getStoredTokenRecord(): Promise<{
    token: string;
    source: LegacyTokenSource | null;
  } | null> {
    const token = await this.secretStore.getSecret(GITHUB_TOKEN_SECRET_KEY);
    if (!token) return null;
    const row = this.db.select().from(kv).where(eq(kv.key, 'github:tokenSource')).get();
    return { token, source: parseTokenSource(row ? JSON.parse(row.value) : null) };
  }

  async clearStoredToken(): Promise<void> {
    await this.secretStore.deleteSecret(GITHUB_TOKEN_SECRET_KEY);
    this.db.delete(kv).where(eq(kv.key, 'github:tokenSource')).run();
  }
}
