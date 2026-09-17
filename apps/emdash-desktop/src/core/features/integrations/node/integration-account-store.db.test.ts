import { openRegistryFixture, type RegistryFixture } from '@tooling/utils/provider-accounts';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@core/services/app-db/node/schema';
import { LegacyAccountImports } from '@core/services/provider-accounts/node/migrations/legacy-account-imports';
import { ProviderAccountService } from '@core/services/provider-accounts/node/provider-account-service';
import { IntegrationAccountStore } from './integration-account-store';
import {
  DEFAULT_INTEGRATION_ACCOUNT_ID,
  LegacyIntegrationAccountsMigration,
} from './migrations/legacy-integration-accounts';

class InMemoryLegacySecrets {
  readonly secrets = new Map<string, string>();
  failNextRead: Error | null = null;

  getSecret = vi.fn(async (key: string) => {
    if (this.failNextRead) {
      const error = this.failNextRead;
      this.failNextRead = null;
      throw error;
    }
    return this.secrets.get(key) ?? null;
  });

  deleteSecret = vi.fn(async (key: string) => {
    this.secrets.delete(key);
  });
}

const silentLogger = { warn: vi.fn() };

describe('IntegrationAccountStore', () => {
  let fixture: RegistryFixture;
  let legacySecrets: InMemoryLegacySecrets;
  let store: IntegrationAccountStore;
  let accountService: ProviderAccountService;

  beforeEach(async () => {
    vi.clearAllMocks();
    fixture = await openRegistryFixture('empty');
    legacySecrets = new InMemoryLegacySecrets();
    const migration = new LegacyIntegrationAccountsMigration(
      fixture.db,
      fixture.registry,
      legacySecrets,
      new LegacyAccountImports(fixture.db, fixture.secretStore, silentLogger)
    );
    store = new IntegrationAccountStore(fixture.registry, (id) => migration.run(id));
    accountService = new ProviderAccountService(fixture.registry, {
      prepare: (providerId) => store.prepare(providerId),
    });
  });

  afterEach(() => {
    fixture?.close();
  });

  function seedConfig(key: string, value: Record<string, unknown>) {
    fixture.db
      .insert(kv)
      .values({ key, value: JSON.stringify(value), updatedAt: 0 })
      .onConflictDoUpdate({ target: kv.key, set: { value: JSON.stringify(value) } })
      .run();
  }

  describe('legacy migration', () => {
    it('does not reimport a removed account after failed cleanup and restart', async () => {
      legacySecrets.secrets.set('emdash-linear-token', 'legacy');
      legacySecrets.deleteSecret.mockRejectedValue(new Error('keychain locked'));
      await expect(
        store.getAccount('linear').then((account) => account?.credentials ?? null)
      ).resolves.toEqual({ apiKey: 'legacy' });
      await accountService.removeAccount('linear', 'default');
      const migration = new LegacyIntegrationAccountsMigration(
        fixture.db,
        fixture.registry,
        legacySecrets,
        new LegacyAccountImports(fixture.db, fixture.secretStore, silentLogger)
      );
      const restarted = new IntegrationAccountStore(fixture.registry, (id) => migration.run(id));
      await expect(
        restarted.getAccount('linear').then((account) => account?.credentials ?? null)
      ).resolves.toBeNull();
      legacySecrets.deleteSecret.mockImplementation(async (key) => {
        legacySecrets.secrets.delete(key);
      });
      await restarted.getAccount('linear').then((account) => account?.credentials ?? null);
      expect(legacySecrets.secrets.size).toBe(0);
      expect(await fixture.registry.listAccounts('linear')).toEqual([]);
    });
    it('retries failed legacy KV reads without marking import complete', async () => {
      legacySecrets.secrets.set('emdash-jira-token', 'legacy');
      fixture.db
        .insert(kv)
        .values({ key: 'jira:creds', value: 'invalid JSON', updatedAt: 0 })
        .run();
      await expect(
        store.getAccount('jira').then((account) => account?.credentials ?? null)
      ).rejects.toThrow();
      expect(
        fixture.db.select().from(kv).where(eq(kv.key, 'integration-account-import:jira')).get()
      ).toBeUndefined();
      seedConfig('jira:creds', { siteUrl: 'https://acme.atlassian.net', email: 'a@b.co' });
      await expect(
        store.getAccount('jira').then((account) => account?.credentials ?? null)
      ).resolves.toEqual({
        apiToken: 'legacy',
        siteUrl: 'https://acme.atlassian.net',
        email: 'a@b.co',
      });
    });

    it('retries real KV cleanup failure after removal and restart without importing again', async () => {
      legacySecrets.secrets.set('emdash-jira-token', 'legacy');
      seedConfig('jira:creds', { siteUrl: 'https://acme.atlassian.net', email: 'a@b.co' });
      fixture.db.run(
        sql`CREATE TRIGGER block_legacy_cleanup BEFORE DELETE ON kv WHEN OLD.key = 'jira:creds' BEGIN SELECT RAISE(FAIL, 'cleanup blocked'); END`
      );
      await store.getAccount('jira').then((account) => account?.credentials ?? null);
      await accountService.removeAccount('jira', 'default');
      const migration = new LegacyIntegrationAccountsMigration(
        fixture.db,
        fixture.registry,
        legacySecrets,
        new LegacyAccountImports(fixture.db, fixture.secretStore, silentLogger)
      );
      await migration.run('jira');
      expect(fixture.db.select().from(kv).where(eq(kv.key, 'jira:creds')).get()).toBeDefined();
      fixture.db.run(sql`DROP TRIGGER block_legacy_cleanup`);
      await migration.run('jira');
      expect(fixture.db.select().from(kv).where(eq(kv.key, 'jira:creds')).get()).toBeUndefined();
      expect(await fixture.registry.listAccounts('jira')).toEqual([]);
    });

    type MigrationCase = {
      integrationId: string;
      seed: () => void;
      expectedCredentials: Record<string, unknown>;
      legacyKeys: string[];
    };

    const cases: MigrationCase[] = [
      {
        integrationId: 'linear',
        seed: () => legacySecrets.secrets.set('emdash-linear-token', '  lin_api_123  '),
        expectedCredentials: { apiKey: 'lin_api_123' },
        legacyKeys: ['emdash-linear-token'],
      },
      {
        integrationId: 'jira',
        seed: () => {
          legacySecrets.secrets.set('emdash-jira-token', ' jira-token ');
          seedConfig('jira:creds', {
            siteUrl: ' https://acme.atlassian.net ',
            email: ' a@b.co ',
          });
        },
        expectedCredentials: {
          siteUrl: 'https://acme.atlassian.net',
          email: 'a@b.co',
          apiToken: 'jira-token',
        },
        legacyKeys: ['emdash-jira-token'],
      },
      {
        integrationId: 'gitlab',
        seed: () => {
          legacySecrets.secrets.set('emdash-gitlab-token', 'glpat-123');
          seedConfig('gitlab:connection', { instanceUrl: 'https://gitlab.example.com' });
        },
        expectedCredentials: { instanceUrl: 'https://gitlab.example.com', apiToken: 'glpat-123' },
        legacyKeys: ['emdash-gitlab-token'],
      },
      {
        integrationId: 'forgejo',
        seed: () => {
          legacySecrets.secrets.set('emdash-forgejo-token', 'forgejo-token');
          seedConfig('forgejo:connection', {
            instanceUrl: 'https://forgejo.example.com',
          });
        },
        expectedCredentials: {
          instanceUrl: 'https://forgejo.example.com',
          apiToken: 'forgejo-token',
        },
        legacyKeys: ['emdash-forgejo-token'],
      },
      {
        integrationId: 'plane',
        seed: () => {
          legacySecrets.secrets.set('emdash-plane-token', 'plane-key');
          seedConfig('plane:connection', {
            apiBaseUrl: 'https://api.plane.so',
            workspaceSlug: 'acme',
          });
        },
        expectedCredentials: {
          apiBaseUrl: 'https://api.plane.so',
          workspaceSlug: 'acme',
          apiKey: 'plane-key',
        },
        legacyKeys: ['emdash-plane-token'],
      },
      {
        integrationId: 'plain',
        seed: () => legacySecrets.secrets.set('emdash-plain-token', 'plain-key'),
        expectedCredentials: { apiKey: 'plain-key' },
        legacyKeys: ['emdash-plain-token'],
      },
      {
        integrationId: 'featurebase',
        seed: () => legacySecrets.secrets.set('emdash-featurebase-token', 'fb-key'),
        expectedCredentials: { apiKey: 'fb-key' },
        legacyKeys: ['emdash-featurebase-token'],
      },
      {
        integrationId: 'asana',
        seed: () => legacySecrets.secrets.set('emdash-asana-token', 'asana-token'),
        expectedCredentials: { accessToken: 'asana-token' },
        legacyKeys: ['emdash-asana-token'],
      },
      {
        integrationId: 'monday',
        seed: () =>
          legacySecrets.secrets.set(
            'emdash-monday-credentials',
            JSON.stringify({ token: 'monday-token', boardIds: ['1', '1', '2'], boardUrls: [] })
          ),
        expectedCredentials: { apiToken: 'monday-token' },
        legacyKeys: ['emdash-monday-credentials'],
      },
      {
        integrationId: 'trello',
        seed: () =>
          legacySecrets.secrets.set(
            'emdash-trello-credentials',
            JSON.stringify({ apiKey: 'trello-key', token: 'trello-token', boardIds: ['b1'] })
          ),
        expectedCredentials: { apiKey: 'trello-key', apiToken: 'trello-token' },
        legacyKeys: ['emdash-trello-credentials'],
      },
    ];

    it.each(cases)(
      'migrates $integrationId legacy credentials into a provider account row',
      async ({ integrationId, seed, expectedCredentials, legacyKeys }) => {
        seed();

        const credentials = await store
          .getAccount(integrationId)
          .then((account) => account?.credentials ?? null);
        expect(credentials).toEqual(expectedCredentials);

        const accounts = await fixture.registry.listAccounts(integrationId);
        expect(accounts).toHaveLength(1);
        expect(accounts[0].accountId).toBe(DEFAULT_INTEGRATION_ACCOUNT_ID);
        await expect(
          fixture.registry.resolveSecret(integrationId, DEFAULT_INTEGRATION_ACCOUNT_ID)
        ).resolves.toBe(JSON.stringify(expectedCredentials));
        for (const key of legacyKeys) {
          expect(legacySecrets.secrets.has(key)).toBe(false);
        }
      }
    );

    it('does not migrate jira when parts of the legacy credentials are missing', async () => {
      legacySecrets.secrets.set('emdash-jira-token', 'jira-token');

      await expect(
        store.getAccount('jira').then((account) => account?.credentials ?? null)
      ).resolves.toBeNull();
      await expect(fixture.registry.listAccounts('jira')).resolves.toEqual([]);
      expect(legacySecrets.secrets.has('emdash-jira-token')).toBe(true);
    });

    it('does not cache a failed migration attempt', async () => {
      legacySecrets.secrets.set('emdash-linear-token', 'lin_api_123');
      legacySecrets.failNextRead = new Error('keychain locked');

      await expect(
        store.getAccount('linear').then((account) => account?.credentials ?? null)
      ).rejects.toThrow('keychain locked');

      // Second attempt succeeds and migrates.
      await expect(
        store.getAccount('linear').then((account) => account?.credentials ?? null)
      ).resolves.toEqual({ apiKey: 'lin_api_123' });
      expect(legacySecrets.secrets.has('emdash-linear-token')).toBe(false);
    });

    it('caches a genuine miss without re-reading legacy keys', async () => {
      await expect(
        store.getAccount('linear').then((account) => account?.credentials ?? null)
      ).resolves.toBeNull();
      const reads = legacySecrets.getSecret.mock.calls.length;
      await expect(
        store.getAccount('linear').then((account) => account?.credentials ?? null)
      ).resolves.toBeNull();
      expect(legacySecrets.getSecret.mock.calls.length).toBe(reads);
    });

    it('does not consult legacy stores when an account already exists', async () => {
      await store.upsertAccount('linear', {
        accountId: DEFAULT_INTEGRATION_ACCOUNT_ID,
        credentials: { apiKey: 'k1' },
      });

      await expect(
        store.getAccount('linear').then((account) => account?.credentials ?? null)
      ).resolves.toEqual({ apiKey: 'k1' });
      expect(legacySecrets.getSecret).not.toHaveBeenCalled();
    });
  });

  describe('accounts', () => {
    it('upserts and resolves the default account', async () => {
      await store.upsertAccount('linear', {
        accountId: DEFAULT_INTEGRATION_ACCOUNT_ID,
        credentials: { apiKey: 'k1' },
      });
      await expect(
        store.getAccount('linear').then((account) => account?.credentials ?? null)
      ).resolves.toEqual({ apiKey: 'k1' });
      await expect(fixture.registry.isConfigured('linear')).resolves.toBe(true);

      await store.upsertAccount('linear', {
        accountId: DEFAULT_INTEGRATION_ACCOUNT_ID,
        credentials: { apiKey: 'k2' },
      });
      await expect(
        store.getAccount('linear').then((account) => account?.credentials ?? null)
      ).resolves.toEqual({ apiKey: 'k2' });
      await expect(fixture.registry.listAccounts('linear')).resolves.toHaveLength(1);
    });

    it('stores the display name in the account metadata', async () => {
      await store.upsertAccount('linear', {
        accountId: DEFAULT_INTEGRATION_ACCOUNT_ID,
        displayName: 'Acme Linear',
        credentials: { apiKey: 'k1' },
      });

      await expect(store.getAccount('linear')).resolves.toEqual({
        accountId: DEFAULT_INTEGRATION_ACCOUNT_ID,
        displayName: 'Acme Linear',
        credentials: { apiKey: 'k1' },
      });
    });

    it('stores multiple accounts and resolves them by id', async () => {
      await store.upsertAccount('github', {
        accountId: 'github.com:1',
        displayName: 'octocat',
        credentials: { accessToken: 't1' },
      });
      await store.upsertAccount('github', {
        accountId: 'github.example.com:2',
        credentials: { accessToken: 't2', apiBaseUrl: 'https://github.example.com/api/v3' },
      });

      await expect(
        store
          .getAccount('github', 'github.example.com:2')
          .then((account) => account?.credentials ?? null)
      ).resolves.toEqual({
        accessToken: 't2',
        apiBaseUrl: 'https://github.example.com/api/v3',
      });
      // No account id given: resolves the default (first connected) account.
      await expect(
        store.getAccount('github').then((account) => account?.credentials ?? null)
      ).resolves.toEqual({ accessToken: 't1', apiBaseUrl: 'https://api.github.com' });
    });

    it('lists account summaries default-first with display metadata', async () => {
      await store.upsertAccount('github', {
        accountId: 'a',
        displayName: 'bravo',
        displayDetail: 'bravo@example.com',
        credentials: { accessToken: 't1' },
      });
      await store.upsertAccount('github', {
        accountId: 'b',
        displayName: 'alpha',
        credentials: { accessToken: 't2' },
      });

      // First connected account is the provider default.
      await expect(accountService.listAccounts('github')).resolves.toMatchObject([
        {
          providerId: 'github',
          accountId: 'a',
          displayName: 'bravo',
          displayDetail: 'bravo@example.com',
          isDefault: true,
        },
        { providerId: 'github', accountId: 'b', displayName: 'alpha', isDefault: false },
      ]);

      await fixture.registry.setDefaultAccount('github', 'b');
      const afterSwitch = await accountService.listAccounts('github');
      expect(afterSwitch.map((account) => account.accountId)).toEqual(['b', 'a']);
      await expect(
        store.getAccount('github').then((account) => account?.credentials ?? null)
      ).resolves.toEqual({ accessToken: 't2', apiBaseUrl: 'https://api.github.com' });
    });

    it('removes only the selected account and its credentials', async () => {
      await store.upsertAccount('github', { accountId: 'a', credentials: { accessToken: 't1' } });
      await store.upsertAccount('github', { accountId: 'b', credentials: { accessToken: 't2' } });

      await fixture.registry.removeAccount('github', 'a');
      await expect(
        store.getAccount('github', 'a').then((account) => account?.credentials ?? null)
      ).resolves.toBeNull();
      await expect(
        store.getAccount('github', 'b').then((account) => account?.credentials ?? null)
      ).resolves.toEqual({ accessToken: 't2', apiBaseUrl: 'https://api.github.com' });

      await fixture.registry.removeAccount('github', 'b');
      await expect(fixture.registry.isConfigured('github')).resolves.toBe(false);
      expect(fixture.secretStore.secrets.size).toBe(0);
    });
  });
});
