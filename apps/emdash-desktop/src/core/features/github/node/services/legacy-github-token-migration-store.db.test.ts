import { openRegistryFixture, type RegistryFixture } from '@tooling/utils/provider-accounts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LegacyGitHubTokenMigrationStore } from './legacy-github-token-migration-store';

describe('LegacyGitHubTokenMigrationStore', () => {
  let fixture: RegistryFixture;
  let store: LegacyGitHubTokenMigrationStore;
  beforeEach(async () => {
    fixture = await openRegistryFixture();
    store = new LegacyGitHubTokenMigrationStore(fixture.db, fixture.secretStore);
    fixture.secretStore.secrets.set('emdash-github-token', 'legacy-token');
  });
  afterEach(() => fixture.close());

  it.each(['cli', 'device_flow', 'unknown'])(
    'reads the persisted token source %s',
    async (source) => {
      fixture.sqlite
        .prepare('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, 0)')
        .run('github:tokenSource', JSON.stringify(source));
      expect(await store.getStoredTokenRecord()).toEqual({
        token: 'legacy-token',
        source: source === 'unknown' ? null : source,
      });
      await store.clearStoredToken();
      expect(await store.getStoredTokenRecord()).toBeNull();
      expect(
        fixture.sqlite.prepare('SELECT value FROM kv WHERE key = ?').get('github:tokenSource')
      ).toBeUndefined();
    }
  );
});
