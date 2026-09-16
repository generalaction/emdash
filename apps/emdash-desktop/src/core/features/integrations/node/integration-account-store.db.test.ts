import { openRegistryFixture, type RegistryFixture } from '@tooling/utils/provider-accounts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectIntegrationAccountResolver } from '@core/features/integrations/api/node/services/project-integration-account-resolver';
import type { StoredProjectGitSettings } from '@core/primitives/project-settings/api';
import type { Project } from '@core/primitives/projects/api';
import {
  IntegrationCredentialStore,
  type IntegrationLegacyStores,
} from './integration-credential-store';

/**
 * End-to-end (real SQLite) QA for the multi-account backend: two Linear
 * workspaces coexist, re-connect replaces in place, default flips, and the
 * per-project resolver picks the right account (and fails closed on a dangling
 * pin). This is the "does the feature actually work" check — there is no UI yet.
 */
const NO_LEGACY: IntegrationLegacyStores = {
  secrets: { getSecret: async () => null, deleteSecret: async () => {} },
  kv: {
    jira: { get: async () => null, del: async () => {} },
    gitlab: { get: async () => null, del: async () => {} },
    forgejo: { get: async () => null, del: async () => {} },
    plane: { get: async () => null, del: async () => {} },
  },
};

describe('IntegrationCredentialStore multi-account (real SQLite)', () => {
  let fixture: RegistryFixture;
  let store: IntegrationCredentialStore;

  beforeEach(async () => {
    fixture = await openRegistryFixture('empty');
    store = new IntegrationCredentialStore(fixture.registry, NO_LEGACY, { warn: () => {} });
  });

  afterEach(() => fixture?.close());

  async function connectWorkspace(accountId: string, label: string, apiKey: string) {
    return store.upsertAccount('linear', {
      accountId,
      displayName: 'Jona',
      workspaceLabel: label,
      credentials: { apiKey, organizationId: accountId.split(':')[1], organizationName: label },
    });
  }

  it('keeps two Linear workspaces instead of overwriting the first', async () => {
    expect(await connectWorkspace('linear:acme', 'Acme', 'lin_acme')).toBe('created');
    expect(await connectWorkspace('linear:beta', 'Beta', 'lin_beta')).toBe('created');

    const accounts = await store.listAccounts('linear');
    expect(accounts).toHaveLength(2);
    expect(accounts.map((a) => a.accountId).sort()).toEqual(['linear:acme', 'linear:beta']);
    // Workspace label round-trips through meta without decrypting the secret.
    expect(accounts.find((a) => a.accountId === 'linear:beta')?.workspaceLabel).toBe('Beta');
    // First connect becomes the default.
    expect(accounts.find((a) => a.isDefault)?.accountId).toBe('linear:acme');
  });

  it('replaces the credential in place when the same workspace reconnects', async () => {
    await connectWorkspace('linear:acme', 'Acme', 'lin_old');
    expect(await connectWorkspace('linear:acme', 'Acme', 'lin_new')).toBe('updated');

    expect(await store.listAccounts('linear')).toHaveLength(1);
    const record = await store.getAccount('linear', 'linear:acme');
    expect(record?.credentials.apiKey).toBe('lin_new');
  });

  it('flips the default account', async () => {
    await connectWorkspace('linear:acme', 'Acme', 'lin_acme');
    await connectWorkspace('linear:beta', 'Beta', 'lin_beta');

    expect(await store.setDefaultAccount('linear', 'linear:beta')).toBe(true);
    const accounts = await store.listAccounts('linear');
    expect(accounts.find((a) => a.isDefault)?.accountId).toBe('linear:beta');
  });

  describe('per-project resolution', () => {
    function resolverFor(stored: StoredProjectGitSettings) {
      return createProjectIntegrationAccountResolver({
        getProjectById: async (id) => ({ id }) as unknown as Project,
        getStoredGitSettings: async () => stored,
        listAccounts: (integrationId) => store.listAccounts(integrationId),
      });
    }

    beforeEach(async () => {
      await connectWorkspace('linear:acme', 'Acme', 'lin_acme'); // default
      await connectWorkspace('linear:beta', 'Beta', 'lin_beta');
    });

    it('resolves an explicit pin to that workspace', async () => {
      const resolve = resolverFor({
        issueTrackerAccounts: { linear: { kind: 'account', accountId: 'linear:beta' } },
      });
      const result = await resolve({ projectId: 'p1', integrationId: 'linear' });
      expect(result.value?.accountId).toBe('linear:beta');
      expect(result.provenance.kind).toBe('set');
    });

    it('fails closed on a dangling pin (never another workspace)', async () => {
      const resolve = resolverFor({
        issueTrackerAccounts: { linear: { kind: 'account', accountId: 'linear:gone' } },
      });
      const result = await resolve({ projectId: 'p1', integrationId: 'linear' });
      expect(result.value).toBeNull();
      expect(result.provenance.kind).toBe('unresolvable');
    });

    it('infers the default account when no pin is set', async () => {
      const resolve = resolverFor({});
      const result = await resolve({ projectId: 'p1', integrationId: 'linear' });
      expect(result.value?.accountId).toBe('linear:acme');
      expect(result.provenance.kind).toBe('inferred');
    });
  });
});
