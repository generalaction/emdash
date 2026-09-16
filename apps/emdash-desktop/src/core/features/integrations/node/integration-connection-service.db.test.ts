import { openRegistryFixture, type RegistryFixture } from '@tooling/utils/provider-accounts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stub the plugin registry so verify() returns a workspace identity without a
// network call. Must be hoisted before the service imports the registry.
const mocks = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock('@emdash/plugins/integrations', () => ({
  integrationPluginRegistry: {
    get: (id: string) =>
      id === 'linear'
        ? { metadata: { name: 'Linear' }, behavior: { auth: { verify: mocks.verify } } }
        : undefined,
  },
}));

import { IntegrationConnectionService } from './integration-connection-service';
import {
  IntegrationCredentialStore,
  type IntegrationLegacyStores,
} from './integration-credential-store';

const NO_LEGACY: IntegrationLegacyStores = {
  secrets: { getSecret: async () => null, deleteSecret: async () => {} },
  kv: {
    jira: { get: async () => null, del: async () => {} },
    gitlab: { get: async () => null, del: async () => {} },
    forgejo: { get: async () => null, del: async () => {} },
    plane: { get: async () => null, del: async () => {} },
  },
};

const CAPS = { issues: false, pullRequests: false, repositories: false } as never;
const logger = { warn: () => {}, error: () => {} } as never;
const telemetry = { capture: () => {} } as never;

describe('IntegrationConnectionService legacy re-identification (real SQLite)', () => {
  let fixture: RegistryFixture;
  let store: IntegrationCredentialStore;
  let service: IntegrationConnectionService;

  beforeEach(async () => {
    fixture = await openRegistryFixture('empty');
    store = new IntegrationCredentialStore(fixture.registry, NO_LEGACY, logger);
    service = new IntegrationConnectionService(store, telemetry, logger);
    mocks.verify.mockReset();
  });
  afterEach(() => fixture?.close());

  it('re-identifies a legacy default account to its workspace id, preserving default', async () => {
    await store.upsertAccount('linear', {
      accountId: 'default',
      credentials: { apiKey: 'lin_legacy' },
    });
    mocks.verify.mockResolvedValue({
      connected: true,
      account: { id: 'acme' },
      displayName: 'Jona',
      displayDetail: 'Acme',
      credentials: { apiKey: 'lin_legacy', organizationId: 'acme', organizationName: 'Acme' },
    });

    const status = await service.checkConnection('linear', CAPS);
    expect(status.connected).toBe(true);

    const accounts = await store.listAccounts('linear');
    expect(accounts).toHaveLength(1);
    expect(accounts[0].accountId).toBe('linear:acme');
    expect(accounts[0].isDefault).toBe(true);
    expect(accounts[0].workspaceLabel).toBe('Acme');
    // The 'default' row is gone.
    expect(await store.getAccount('linear', 'default')).toBeNull();
  });

  it('drops the stale default without overwriting an already-connected workspace', async () => {
    // The user already connected the workspace properly (new token) AND a stale
    // 'default' row for the same org still exists (old token).
    await store.upsertAccount('linear', {
      accountId: 'linear:acme',
      credentials: { apiKey: 'lin_new' },
    });
    await store.upsertAccount('linear', {
      accountId: 'default',
      credentials: { apiKey: 'lin_old' },
    });
    mocks.verify.mockResolvedValue({
      connected: true,
      account: { id: 'acme' },
      credentials: { apiKey: 'lin_old', organizationId: 'acme' },
    });

    await service.checkConnection('linear', CAPS, 'default');

    const accounts = await store.listAccounts('linear');
    expect(accounts).toHaveLength(1);
    const record = await store.getAccount('linear', 'linear:acme');
    // The good, already-connected credential is preserved — not clobbered.
    expect(record?.credentials.apiKey).toBe('lin_new');
    expect(await store.getAccount('linear', 'default')).toBeNull();
  });

  it('keeps the migrated workspace as default when a legacy default is re-identified alongside another account', async () => {
    // Another workspace exists, and the legacy 'default' row is the selected
    // default. Deleting 'default' must not promote the other account: the
    // re-identified workspace inherits the default selection.
    await store.upsertAccount('linear', {
      accountId: 'linear:other',
      credentials: { apiKey: 'lin_other' },
    });
    await store.upsertAccount('linear', {
      accountId: 'default',
      credentials: { apiKey: 'lin_legacy' },
    });
    await store.setDefaultAccount('linear', 'default');
    mocks.verify.mockResolvedValue({
      connected: true,
      account: { id: 'acme' },
      displayDetail: 'Acme',
      credentials: { apiKey: 'lin_legacy', organizationId: 'acme' },
    });

    await service.checkConnection('linear', CAPS, 'default');

    const accounts = await store.listAccounts('linear');
    expect(accounts).toHaveLength(2);
    expect(await store.getDefaultAccountId('linear')).toBe('linear:acme');
    expect(accounts.find((a) => a.accountId === 'linear:other')?.isDefault).toBe(false);
    expect(await store.getAccount('linear', 'default')).toBeNull();
  });

  it('is idempotent once migrated (no default row left to migrate)', async () => {
    await store.upsertAccount('linear', {
      accountId: 'linear:acme',
      credentials: { apiKey: 'lin_new' },
    });
    mocks.verify.mockResolvedValue({
      connected: true,
      account: { id: 'acme' },
      credentials: { apiKey: 'lin_new', organizationId: 'acme' },
    });

    await service.checkConnection('linear', CAPS, 'linear:acme');
    const accounts = await store.listAccounts('linear');
    expect(accounts).toHaveLength(1);
    expect(accounts[0].accountId).toBe('linear:acme');
  });
});
