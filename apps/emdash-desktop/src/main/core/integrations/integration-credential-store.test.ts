import { beforeEach, describe, expect, it, vi } from 'vitest';

const { secrets, kvStores, mockGetSecret, mockSetSecret, mockDeleteSecret } = vi.hoisted(() => {
  const secrets = new Map<string, string>();
  const kvStores = new Map<string, Map<string, unknown>>();
  return {
    secrets,
    kvStores,
    mockGetSecret: vi.fn(async (key: string) => secrets.get(key) ?? null),
    mockSetSecret: vi.fn(async (key: string, value: string) => {
      secrets.set(key, value);
    }),
    mockDeleteSecret: vi.fn(async (key: string) => {
      secrets.delete(key);
    }),
  };
});

vi.mock('@main/core/secrets/encrypted-app-secrets-store', () => ({
  encryptedAppSecretsStore: {
    getSecret: (...args: [string]) => mockGetSecret(...args),
    setSecret: (...args: [string, string]) => mockSetSecret(...args),
    deleteSecret: (...args: [string]) => mockDeleteSecret(...args),
  },
}));

vi.mock('@main/db/kv', () => ({
  KV: class {
    constructor(private readonly namespace: string) {
      if (!kvStores.has(namespace)) kvStores.set(namespace, new Map());
    }

    async get(key: string) {
      return kvStores.get(this.namespace)?.get(key) ?? null;
    }

    async set(key: string, value: unknown) {
      kvStores.get(this.namespace)?.set(key, value);
    }

    async del(key: string) {
      kvStores.get(this.namespace)?.delete(key);
    }
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  DEFAULT_INTEGRATION_ACCOUNT_ID,
  IntegrationCredentialStore,
} from './integration-credential-store';

function seedKv(namespace: string, key: string, value: unknown) {
  if (!kvStores.has(namespace)) kvStores.set(namespace, new Map());
  kvStores.get(namespace)?.set(key, value);
}

function storedRecord(integrationId: string) {
  const raw = secrets.get(`integration:${integrationId}`);
  return raw ? JSON.parse(raw) : null;
}

describe('IntegrationCredentialStore legacy migration', () => {
  let store: IntegrationCredentialStore;

  beforeEach(() => {
    vi.clearAllMocks();
    secrets.clear();
    kvStores.clear();
    store = new IntegrationCredentialStore();
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
      seed: () => secrets.set('emdash-linear-token', '  lin_api_123  '),
      expectedCredentials: { apiKey: 'lin_api_123' },
      legacyKeys: ['emdash-linear-token'],
    },
    {
      integrationId: 'jira',
      seed: () => {
        secrets.set('emdash-jira-token', ' jira-token ');
        seedKv('jira', 'creds', { siteUrl: ' https://acme.atlassian.net ', email: ' a@b.co ' });
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
        secrets.set('emdash-gitlab-token', 'glpat-123');
        seedKv('gitlab', 'connection', { instanceUrl: 'https://gitlab.example.com' });
      },
      expectedCredentials: { instanceUrl: 'https://gitlab.example.com', apiToken: 'glpat-123' },
      legacyKeys: ['emdash-gitlab-token'],
    },
    {
      integrationId: 'forgejo',
      seed: () => {
        secrets.set('emdash-forgejo-token', 'forgejo-token');
        seedKv('forgejo', 'connection', { instanceUrl: 'https://forgejo.example.com' });
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
        secrets.set('emdash-plane-token', 'plane-key');
        seedKv('plane', 'connection', {
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
      seed: () => secrets.set('emdash-plain-token', 'plain-key'),
      expectedCredentials: { apiKey: 'plain-key' },
      legacyKeys: ['emdash-plain-token'],
    },
    {
      integrationId: 'featurebase',
      seed: () => secrets.set('emdash-featurebase-token', 'fb-key'),
      expectedCredentials: { apiKey: 'fb-key' },
      legacyKeys: ['emdash-featurebase-token'],
    },
    {
      integrationId: 'asana',
      seed: () => secrets.set('emdash-asana-token', 'asana-token'),
      expectedCredentials: { accessToken: 'asana-token' },
      legacyKeys: ['emdash-asana-token'],
    },
    {
      integrationId: 'monday',
      seed: () =>
        secrets.set(
          'emdash-monday-credentials',
          JSON.stringify({ token: 'monday-token', boardIds: ['1', '1', '2'], boardUrls: [] })
        ),
      expectedCredentials: { apiToken: 'monday-token', boardIds: ['1', '2'], boardUrls: [] },
      legacyKeys: ['emdash-monday-credentials'],
    },
    {
      integrationId: 'trello',
      seed: () =>
        secrets.set(
          'emdash-trello-credentials',
          JSON.stringify({ apiKey: 'trello-key', token: 'trello-token', boardIds: ['b1'] })
        ),
      expectedCredentials: { apiKey: 'trello-key', apiToken: 'trello-token', boardIds: ['b1'] },
      legacyKeys: ['emdash-trello-credentials'],
    },
  ];

  it.each(cases)(
    'migrates $integrationId legacy credentials into the account-shaped record',
    async ({ integrationId, seed, expectedCredentials, legacyKeys }) => {
      seed();

      const credentials = await store.get(integrationId);
      expect(credentials).toEqual(expectedCredentials);

      expect(storedRecord(integrationId)).toEqual({
        accounts: [{ accountId: DEFAULT_INTEGRATION_ACCOUNT_ID, credentials: expectedCredentials }],
      });
      for (const key of legacyKeys) {
        expect(secrets.has(key)).toBe(false);
      }
    }
  );

  it('does not migrate jira when parts of the legacy credentials are missing', async () => {
    secrets.set('emdash-jira-token', 'jira-token');

    await expect(store.get('jira')).resolves.toBeNull();
    expect(storedRecord('jira')).toBeNull();
    expect(secrets.has('emdash-jira-token')).toBe(true);
  });

  it('does not cache a failed migration attempt', async () => {
    secrets.set('emdash-linear-token', 'lin_api_123');
    mockGetSecret
      .mockResolvedValueOnce(null) // integration:linear read
      .mockRejectedValueOnce(new Error('keychain locked')); // legacy read fails

    await expect(store.get('linear')).resolves.toBeNull();

    // Second attempt succeeds and migrates.
    await expect(store.get('linear')).resolves.toEqual({ apiKey: 'lin_api_123' });
    expect(secrets.has('emdash-linear-token')).toBe(false);
  });

  it('caches a genuine miss without re-reading legacy keys', async () => {
    await expect(store.get('linear')).resolves.toBeNull();
    const reads = mockGetSecret.mock.calls.length;
    await expect(store.get('linear')).resolves.toBeNull();
    expect(mockGetSecret.mock.calls.length).toBe(reads);
  });
});

describe('IntegrationCredentialStore accounts', () => {
  let store: IntegrationCredentialStore;

  beforeEach(() => {
    vi.clearAllMocks();
    secrets.clear();
    kvStores.clear();
    store = new IntegrationCredentialStore();
  });

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
    expect(storedRecord('linear').accounts).toHaveLength(1);
  });

  it('stores multiple accounts and resolves them by id', async () => {
    await store.upsertAccount('github', {
      accountId: 'github.com:1',
      displayName: 'octocat',
      credentials: { accessToken: 't1' },
    });
    await store.upsertAccount('github', {
      accountId: 'ghe.example.com:2',
      credentials: { accessToken: 't2', apiBaseUrl: 'https://ghe.example.com/api/v3' },
    });

    await expect(store.get('github', 'ghe.example.com:2')).resolves.toEqual({
      accessToken: 't2',
      apiBaseUrl: 'https://ghe.example.com/api/v3',
    });
    // No 'default' account: falls back to the first stored account.
    await expect(store.get('github')).resolves.toEqual({ accessToken: 't1' });
  });

  it('deletes one account or all accounts', async () => {
    await store.upsertAccount('github', { accountId: 'a', credentials: { accessToken: 't1' } });
    await store.upsertAccount('github', { accountId: 'b', credentials: { accessToken: 't2' } });

    await store.delete('github', 'a');
    await expect(store.get('github', 'a')).resolves.toBeNull();
    await expect(store.get('github', 'b')).resolves.toEqual({ accessToken: 't2' });

    await store.delete('github');
    await expect(store.isConfigured('github')).resolves.toBe(false);
    expect(secrets.has('integration:github')).toBe(false);
  });

  it('wraps a flat interim-format record as the default account', async () => {
    secrets.set('integration:linear', JSON.stringify({ apiKey: 'flat-key' }));

    await expect(store.get('linear')).resolves.toEqual({ apiKey: 'flat-key' });
    const account = await store.getAccount('linear');
    expect(account?.accountId).toBe(DEFAULT_INTEGRATION_ACCOUNT_ID);
  });
});
