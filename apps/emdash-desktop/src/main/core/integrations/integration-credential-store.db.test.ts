import { openRegistryFixture, type RegistryFixture } from '@tooling/utils/provider-accounts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_INTEGRATION_ACCOUNT_ID,
  IntegrationCredentialStore,
  type IntegrationLegacyStores,
} from './integration-credential-store';

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

class InMemoryLegacyKv {
  readonly entries = new Map<string, Record<string, unknown>>();

  async get(key: string) {
    return this.entries.get(key) ?? null;
  }

  async del(key: string) {
    this.entries.delete(key);
  }
}

const silentLogger = { warn: vi.fn() };

describe('IntegrationCredentialStore', () => {
  let fixture: RegistryFixture;
  let legacySecrets: InMemoryLegacySecrets;
  let legacyKv: Record<'jira' | 'gitlab' | 'forgejo' | 'plane', InMemoryLegacyKv>;
  let store: IntegrationCredentialStore;

  beforeEach(async () => {
    vi.clearAllMocks();
    fixture = await openRegistryFixture('empty');
    legacySecrets = new InMemoryLegacySecrets();
    legacyKv = {
      jira: new InMemoryLegacyKv(),
      gitlab: new InMemoryLegacyKv(),
      forgejo: new InMemoryLegacyKv(),
      plane: new InMemoryLegacyKv(),
    };
    const legacy: IntegrationLegacyStores = { secrets: legacySecrets, kv: legacyKv };
    store = new IntegrationCredentialStore(fixture.registry, legacy, silentLogger);
  });

  afterEach(() => {
    fixture?.close();
  });

  describe('legacy migration', () => {
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
          legacyKv.jira.entries.set('creds', {
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
          legacyKv.gitlab.entries.set('connection', { instanceUrl: 'https://gitlab.example.com' });
        },
        expectedCredentials: { instanceUrl: 'https://gitlab.example.com', apiToken: 'glpat-123' },
        legacyKeys: ['emdash-gitlab-token'],
      },
      {
        integrationId: 'forgejo',
        seed: () => {
          legacySecrets.secrets.set('emdash-forgejo-token', 'forgejo-token');
          legacyKv.forgejo.entries.set('connection', {
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
          legacyKv.plane.entries.set('connection', {
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
        expectedCredentials: { apiToken: 'monday-token', boardIds: ['1', '2'], boardUrls: [] },
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

        const credentials = await store.get(integrationId);
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

      await expect(store.get('jira')).resolves.toBeNull();
      await expect(fixture.registry.listAccounts('jira')).resolves.toEqual([]);
      expect(legacySecrets.secrets.has('emdash-jira-token')).toBe(true);
    });

    it('does not cache a failed migration attempt', async () => {
      legacySecrets.secrets.set('emdash-linear-token', 'lin_api_123');
      legacySecrets.failNextRead = new Error('keychain locked');

      await expect(store.get('linear')).resolves.toBeNull();

      // Second attempt succeeds and migrates.
      await expect(store.get('linear')).resolves.toEqual({ apiKey: 'lin_api_123' });
      expect(legacySecrets.secrets.has('emdash-linear-token')).toBe(false);
    });

    it('caches a genuine miss without re-reading legacy keys', async () => {
      await expect(store.get('linear')).resolves.toBeNull();
      const reads = legacySecrets.getSecret.mock.calls.length;
      await expect(store.get('linear')).resolves.toBeNull();
      expect(legacySecrets.getSecret.mock.calls.length).toBe(reads);
    });

    it('does not consult legacy stores when an account already exists', async () => {
      await store.upsertAccount('linear', {
        accountId: DEFAULT_INTEGRATION_ACCOUNT_ID,
        credentials: { apiKey: 'k1' },
      });

      await expect(store.get('linear')).resolves.toEqual({ apiKey: 'k1' });
      expect(legacySecrets.getSecret).not.toHaveBeenCalled();
    });
  });

  describe('accounts', () => {
    it('upserts and resolves the default account', async () => {
      await store.upsertAccount('linear', {
        accountId: DEFAULT_INTEGRATION_ACCOUNT_ID,
        credentials: { apiKey: 'k1' },
      });
      await expect(store.get('linear')).resolves.toEqual({ apiKey: 'k1' });
      await expect(store.isConfigured('linear')).resolves.toBe(true);

      await store.upsertAccount('linear', {
        accountId: DEFAULT_INTEGRATION_ACCOUNT_ID,
        credentials: { apiKey: 'k2' },
      });
      await expect(store.get('linear')).resolves.toEqual({ apiKey: 'k2' });
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
      await store.upsertAccount('gitea', {
        accountId: 'gitea.com:1',
        displayName: 'octocat',
        credentials: { accessToken: 't1' },
      });
      await store.upsertAccount('gitea', {
        accountId: 'gitea.example.com:2',
        credentials: { accessToken: 't2', apiBaseUrl: 'https://gitea.example.com/api/v1' },
      });

      await expect(store.get('gitea', 'gitea.example.com:2')).resolves.toEqual({
        accessToken: 't2',
        apiBaseUrl: 'https://gitea.example.com/api/v1',
      });
      // No account id given: resolves the default (first connected) account.
      await expect(store.get('gitea')).resolves.toEqual({ accessToken: 't1' });
    });

    it('deletes one account or all accounts', async () => {
      await store.upsertAccount('gitea', { accountId: 'a', credentials: { accessToken: 't1' } });
      await store.upsertAccount('gitea', { accountId: 'b', credentials: { accessToken: 't2' } });

      await store.delete('gitea', 'a');
      await expect(store.get('gitea', 'a')).resolves.toBeNull();
      await expect(store.get('gitea', 'b')).resolves.toEqual({ accessToken: 't2' });

      await store.delete('gitea');
      await expect(store.isConfigured('gitea')).resolves.toBe(false);
      expect(fixture.secretStore.secrets.size).toBe(0);
    });
  });
});
