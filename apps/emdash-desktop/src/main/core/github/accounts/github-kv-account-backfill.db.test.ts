import { openRegistryFixture, type RegistryFixture } from '@tooling/utils/provider-accounts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GITHUB_PROVIDER_ID, upsertGitHubAccount } from './github-accounts';
import {
  GitHubKvAccountBackfillService,
  legacyGitHubTokenRef,
  type LegacyGitHubAccountsKv,
  type LegacyKvGitHubAccount,
} from './github-kv-account-backfill';

function kvAccount(
  id: string,
  overrides: Partial<LegacyKvGitHubAccount> = {}
): LegacyKvGitHubAccount {
  const [host = 'github.com', providerAccountId = id] = id.split(':');
  return {
    id,
    providerAccountId,
    host,
    login: `user-${providerAccountId}`,
    avatarUrl: `https://avatars.githubusercontent.com/u/${providerAccountId}`,
    credentialSource: 'emdash_oauth',
    connectedAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

/** The `githubAccounts` KV namespace as released builds wrote it, on the fixture DB. */
function kvOnFixture(fixture: RegistryFixture): LegacyGitHubAccountsKv & {
  seed(accounts: LegacyKvGitHubAccount[], defaultAccountId?: string | null): void;
  rows(): { key: string }[];
} {
  const read = (key: string): unknown => {
    const row = fixture.sqlite
      .prepare(`SELECT value FROM kv WHERE key = ?`)
      .get(`githubAccounts:${key}`) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  };
  return {
    async getAccounts() {
      return read('accounts') as LegacyKvGitHubAccount[] | null;
    },
    async getDefaultAccountId() {
      return read('defaultAccountId') as string | null;
    },
    async clear() {
      fixture.sqlite.prepare(`DELETE FROM kv WHERE key LIKE 'githubAccounts:%'`).run();
    },
    seed(accounts, defaultAccountId = null) {
      const insert = fixture.sqlite.prepare(
        `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, 1)`
      );
      insert.run('githubAccounts:accounts', JSON.stringify(accounts));
      insert.run('githubAccounts:defaultAccountId', JSON.stringify(defaultAccountId));
      insert.run('githubAccounts:removedCliAccounts', JSON.stringify([]));
    },
    rows() {
      return fixture.sqlite
        .prepare(`SELECT key FROM kv WHERE key LIKE 'githubAccounts:%'`)
        .all() as { key: string }[];
    },
  };
}

describe('GitHubKvAccountBackfillService', () => {
  let fixture: RegistryFixture;
  let kv: ReturnType<typeof kvOnFixture>;
  let service: GitHubKvAccountBackfillService;

  beforeEach(async () => {
    fixture = await openRegistryFixture('empty');
    kv = kvOnFixture(fixture);
    service = new GitHubKvAccountBackfillService(fixture.registry, kv);
  });

  afterEach(() => {
    fixture?.close();
  });

  it('moves KV account metadata into provider_accounts and deletes the namespace', async () => {
    kv.seed(
      [kvAccount('github.com:42'), kvAccount('ghe.example.com:7', { credentialSource: 'cli' })],
      'ghe.example.com:7'
    );

    const imported = await service.backfillFromKv();

    expect(imported.map((account) => account.id)).toEqual(['github.com:42', 'ghe.example.com:7']);
    const accounts = await fixture.registry.listAccounts(GITHUB_PROVIDER_ID);
    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({
      accountId: 'github.com:42',
      credentialRef: legacyGitHubTokenRef('github.com:42'),
      meta: { login: 'user-42', host: 'github.com', credentialSource: 'emdash_oauth' },
    });
    await expect(fixture.registry.getDefaultAccountId(GITHUB_PROVIDER_ID)).resolves.toBe(
      'ghe.example.com:7'
    );
    expect(kv.rows()).toEqual([]);
  });

  it('points credentialRefs at the released token keys without moving secrets', async () => {
    fixture.secretStore.secrets.set(legacyGitHubTokenRef('github.com:42'), 'gho_released');
    kv.seed([kvAccount('github.com:42')]);

    await service.backfillFromKv();

    await expect(fixture.registry.resolveSecret(GITHUB_PROVIDER_ID, 'github.com:42')).resolves.toBe(
      'gho_released'
    );
  });

  it('falls back to the oldest account when the KV default is unknown', async () => {
    kv.seed([kvAccount('github.com:42'), kvAccount('github.com:84')], 'github.com:missing');

    await service.backfillFromKv();

    await expect(fixture.registry.getDefaultAccountId(GITHUB_PROVIDER_ID)).resolves.toBe(
      'github.com:42'
    );
  });

  it('is idempotent: the second run is a no-op', async () => {
    kv.seed([kvAccount('github.com:42')]);

    await service.backfillFromKv();
    const second = await service.backfillFromKv();

    expect(second).toEqual([]);
    await expect(fixture.registry.listAccounts(GITHUB_PROVIDER_ID)).resolves.toHaveLength(1);
  });

  it('does not disturb accounts that already exist in the registry', async () => {
    await upsertGitHubAccount(fixture.registry, {
      accessToken: 'gho_fresh',
      credentialSource: 'emdash_oauth',
      providerAccount: {
        providerId: 'github',
        providerAccountId: '42',
        host: 'github.com',
        login: 'monalisa',
        avatarUrl: '',
      },
    });
    kv.seed([kvAccount('github.com:42', { login: 'stale-login' })]);

    await service.backfillFromKv();

    const accounts = await fixture.registry.listAccounts(GITHUB_PROVIDER_ID);
    expect(accounts).toHaveLength(1);
    // The existing row keeps its credentialRef, so the fresh token stays valid.
    await expect(fixture.registry.resolveSecret(GITHUB_PROVIDER_ID, 'github.com:42')).resolves.toBe(
      'gho_fresh'
    );
  });

  it('does nothing when the KV namespace is empty', async () => {
    await expect(service.backfillFromKv()).resolves.toEqual([]);
    await expect(fixture.registry.listAccounts(GITHUB_PROVIDER_ID)).resolves.toEqual([]);
  });
});
