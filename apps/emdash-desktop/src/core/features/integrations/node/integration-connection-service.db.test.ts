import type { IIntegrationAuthBehavior } from '@emdash/plugins/integrations';
import type * as Integrations from '@emdash/plugins/integrations';
import type { Logger } from '@emdash/shared/logger';
import { deferred } from '@emdash/shared/testing';
import { openRegistryFixture, type RegistryFixture } from '@tooling/utils/provider-accounts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderAccountService } from '@core/services/provider-accounts/node/provider-account-service';
import { IntegrationAccountStore } from './integration-account-store';
import { IntegrationConnectionService } from './integration-connection-service';

const { verify } = vi.hoisted(() => ({ verify: vi.fn<IIntegrationAuthBehavior['verify']>() }));
vi.mock('@emdash/plugins/integrations', async (importOriginal) => {
  const actual = await importOriginal<typeof Integrations>();
  return {
    ...actual,
    integrationPluginRegistry: {
      get: (id: string) => {
        const plugin = actual.integrationPluginRegistry.get(id);
        return plugin && { ...plugin, behavior: { auth: { ...plugin.behavior.auth, verify } } };
      },
    },
  };
});

describe('IntegrationConnectionService account identity', () => {
  let fixture: RegistryFixture;
  let credentials: IntegrationAccountStore;
  let service: IntegrationConnectionService;
  const capture = vi.fn();
  const accountsChanged = vi.fn();
  const identity = { id: 'org:user', login: 'ada', host: 'linear.app' };

  beforeEach(async () => {
    vi.clearAllMocks();
    fixture = await openRegistryFixture();
    credentials = new IntegrationAccountStore(fixture.registry, async () => {});
    service = new IntegrationConnectionService(
      fixture.registry,
      credentials,
      { capture },
      { error: vi.fn(), warn: vi.fn() } as unknown as Logger,
      accountsChanged
    );
    verify.mockImplementation(async (_host, supplied) => ({
      connected: true,
      account: identity,
      displayName: 'Ada',
      credentials: supplied,
    }));
  });

  afterEach(() => fixture?.close());

  it('publishes one inventory change and connection event for each saved connection', async () => {
    const connected = await service.connect('linear', { apiKey: 'one' });
    if (!connected.success) throw new Error(connected.error);
    expect(accountsChanged).toHaveBeenCalledExactlyOnceWith('linear');
    expect(capture).toHaveBeenCalledExactlyOnceWith('integration_connected', {
      provider: 'linear',
    });
    expect(await credentials.getAccount('linear', connected.accountId)).not.toBeNull();

    await service.connect('linear', { apiKey: 'replacement' }, { accountId: connected.accountId });
    expect(accountsChanged).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it('does not publish account changes or connection telemetry for a rejected connection', async () => {
    verify.mockResolvedValue({ connected: false, error: 'Invalid credentials' });
    await expect(service.connect('linear', { apiKey: 'invalid' })).resolves.toMatchObject({
      success: false,
    });
    expect(accountsChanged).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it('does not publish a connection before credential persistence succeeds', async () => {
    vi.spyOn(credentials, 'upsertAccount').mockRejectedValueOnce(
      new Error('Secret store unavailable')
    );
    await expect(service.connect('linear', { apiKey: 'one' })).rejects.toThrow(
      'Secret store unavailable'
    );
    expect(accountsChanged).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it('persists canonical credentials and deduplicates a stable identity without a login', async () => {
    verify.mockResolvedValue({
      connected: true,
      account: { id: 'bot-1' },
      displayName: 'Emdash',
      credentials: { apiToken: 'normalized-token' },
    });

    const result = await service.connect('notion', {
      apiToken: ' normalized-token ',
      staleField: 'discard',
    });
    if (!result.success) throw new Error(result.error);

    expect(await credentials.getAccount('notion', result.accountId)).toEqual({
      accountId: result.accountId,
      displayName: 'Emdash',
      identity: { id: 'bot-1', scope: 'notion' },
      credentials: { apiToken: 'normalized-token' },
    });
    expect(await fixture.registry.resolveSecret('notion', result.accountId)).toBe(
      JSON.stringify({ apiToken: 'normalized-token' })
    );
    await service.connect('notion', { apiToken: 'normalized-token' });
    expect(await fixture.registry.listAccounts('notion')).toHaveLength(1);
  });

  it('adopts the verified identity of a legacy account without changing its ID or default', async () => {
    await credentials.upsertAccount('linear', {
      accountId: 'default',
      credentials: { apiKey: 'old' },
    });

    await expect(service.connect('linear', { apiKey: 'new' })).resolves.toMatchObject({
      success: true,
      accountId: 'default',
    });
    expect(await fixture.registry.listAccounts('linear')).toHaveLength(1);
    expect(
      await credentials
        .getAccount('linear', 'default')
        .then((account) => account?.credentials ?? null)
    ).toEqual({ apiKey: 'new' });
    expect((await fixture.registry.getAccount('linear', 'default'))?.meta).toMatchObject({
      providerAccountId: 'org:user',
      host: 'linear.app',
      login: 'ada',
    });
  });

  it('refreshes an expired legacy account explicitly while preserving project references', async () => {
    await credentials.upsertAccount('linear', {
      accountId: 'default',
      credentials: { apiKey: 'expired' },
    });
    await expect(
      service.connect('linear', { apiKey: 'new' }, { accountId: 'default' })
    ).resolves.toMatchObject({ success: true, accountId: 'default' });
    expect(
      await credentials
        .getAccount('linear', 'default')
        .then((account) => account?.credentials ?? null)
    ).toEqual({ apiKey: 'new' });
  });

  it('does not resurrect a legacy ID removed during identity adoption', async () => {
    await credentials.upsertAccount('linear', {
      accountId: 'default',
      credentials: { apiKey: 'old' },
    });
    const started = deferred();
    const finish = deferred();
    verify.mockImplementation(async (_host, supplied) => {
      if (supplied.apiKey === 'old') {
        started.resolve();
        await finish.promise;
      }
      return { connected: true, account: identity, displayName: 'Ada', credentials: supplied };
    });
    const connecting = service.connect('linear', { apiKey: 'new' });
    await started.promise;
    await fixture.registry.removeAccount('linear', 'default');
    finish.resolve();
    expect(await connecting).toMatchObject({ success: true, accountId: 'linear.app:org:user' });
    expect(await fixture.registry.getAccount('linear', 'default')).toBeNull();
  });

  it.each([true, false])(
    'rejects a different identity during reconnect (secret present=%s)',
    async (secretPresent) => {
      const first = await service.connect('linear', { apiKey: 'first' });
      if (!first.success) throw new Error(first.error);
      if (!secretPresent) fixture.secretStore.secrets.clear();
      verify.mockResolvedValue({
        connected: true,
        account: { ...identity, id: 'other' },
        credentials: { apiKey: 'other' },
      });
      await expect(
        service.connect('linear', { apiKey: 'other' }, { accountId: first.accountId })
      ).resolves.toMatchObject({ success: false });
      expect(
        await credentials
          .getAccount('linear', first.accountId)
          .then((account) => account?.credentials ?? null)
      ).toEqual(secretPresent ? { apiKey: 'first' } : null);
      expect(await fixture.registry.listAccounts('linear')).toHaveLength(1);
    }
  );

  it.each([null, 'invalid json'])(
    'repairs an account with an unreadable secret (%s)',
    async (raw) => {
      const first = await service.connect('linear', { apiKey: 'first' });
      if (!first.success) throw new Error(first.error);
      const saved = await fixture.registry.getAccount('linear', first.accountId);
      if (!saved) throw new Error('Missing account');
      if (raw === null) fixture.secretStore.secrets.delete(saved.credentialRef);
      else fixture.secretStore.secrets.set(saved.credentialRef, raw);

      await expect(
        service.connect('linear', { apiKey: 'replacement' }, { accountId: first.accountId })
      ).resolves.toMatchObject({ success: true, accountId: first.accountId });
      expect(
        await credentials
          .getAccount('linear', first.accountId)
          .then((account) => account?.credentials ?? null)
      ).toEqual({ apiKey: 'replacement' });
      expect(await fixture.registry.listAccounts('linear')).toHaveLength(1);
    }
  );

  it('does not recreate an account removed while verification is in flight', async () => {
    const first = await service.connect('linear', { apiKey: 'first' });
    if (!first.success) throw new Error(first.error);
    const started = deferred();
    const finish = deferred();
    verify.mockImplementationOnce(async () => {
      started.resolve();
      await finish.promise;
      return { connected: true, account: identity, credentials: { apiKey: 'first' } };
    });
    const checking = service.checkConnection('linear', {
      requiresRepositoryUrl: false,
      supportsIssueContext: true,
    });
    await started.promise;
    await new ProviderAccountService(fixture.registry).removeAccount('linear', first.accountId);
    finish.resolve();
    await checking;

    expect(await fixture.registry.listAccounts('linear')).toEqual([]);
    expect(fixture.secretStore.secrets.size).toBe(0);
  });

  it('does not overwrite a reconnect completed while verification is in flight', async () => {
    const first = await service.connect('linear', { apiKey: 'first' });
    if (!first.success) throw new Error(first.error);
    const started = deferred();
    const finish = deferred();
    verify.mockImplementationOnce(async () => {
      started.resolve();
      await finish.promise;
      return { connected: true, account: identity, credentials: { apiKey: 'first' } };
    });
    const checking = service.checkConnection('linear', {
      requiresRepositoryUrl: false,
      supportsIssueContext: true,
    });
    await started.promise;
    await service.connect('linear', { apiKey: 'replacement' }, { accountId: first.accountId });
    finish.resolve();
    await checking;

    expect(
      await credentials
        .getAccount('linear', first.accountId)
        .then((account) => account?.credentials ?? null)
    ).toEqual({ apiKey: 'replacement' });
  });

  it('requires a label for providers without a verified identity and reconnects that row', async () => {
    verify.mockImplementation(async (_host, supplied) => ({
      connected: true,
      credentials: supplied,
    }));
    await expect(service.connect('plain', { apiKey: 'first' })).resolves.toMatchObject({
      success: false,
    });
    const first = await service.connect('plain', { apiKey: 'first' }, { displayName: 'Acme' });
    if (!first.success) throw new Error(first.error);
    expect(first.accountId).not.toBe('default');
    await expect(
      service.connect('plain', { apiKey: 'rotated' }, { accountId: first.accountId })
    ).resolves.toMatchObject({ success: true, accountId: first.accountId, displayName: 'Acme' });
    expect(await fixture.registry.listAccounts('plain')).toHaveLength(1);
    expect(
      await credentials
        .getAccount('plain', first.accountId)
        .then((account) => account?.credentials ?? null)
    ).toEqual({ apiKey: 'rotated' });
  });

  it('does not deduplicate distinct identities by their matching display names', async () => {
    await service.connect('linear', { apiKey: 'one' });
    verify.mockResolvedValue({
      connected: true,
      account: { ...identity, id: 'another' },
      displayName: 'Ada',
      credentials: { apiKey: 'two' },
    });
    await service.connect('linear', { apiKey: 'two' });
    expect(await fixture.registry.listAccounts('linear')).toHaveLength(2);
  });

  it('does not retarget a known account when a connection check reports a different identity', async () => {
    const first = await service.connect('linear', { apiKey: 'one' });
    if (!first.success) throw new Error(first.error);
    verify.mockResolvedValue({
      connected: true,
      account: { ...identity, id: 'other' },
      credentials: { apiKey: 'two' },
    });
    expect(
      (
        await service.checkConnection(
          'linear',
          { requiresRepositoryUrl: false, supportsIssueContext: true },
          first.accountId
        )
      ).connected
    ).toBe(false);
    expect(
      await credentials
        .getAccount('linear', first.accountId)
        .then((account) => account?.credentials ?? null)
    ).toEqual({ apiKey: 'one' });
  });

  it('reports live health without changing saved account metadata or its user label', async () => {
    const first = await service.connect('linear', { apiKey: 'one' }, { displayName: 'Work' });
    if (!first.success) throw new Error(first.error);
    const saved = await fixture.registry.getAccount('linear', first.accountId);
    verify.mockResolvedValue({
      connected: true,
      account: identity,
      displayName: 'Ada Lovelace',
      credentials: { apiKey: 'one' },
    });
    await service.checkConnection(
      'linear',
      { requiresRepositoryUrl: false, supportsIssueContext: true },
      first.accountId
    );
    expect(
      (await new ProviderAccountService(fixture.registry).listAccounts('linear'))[0]?.displayName
    ).toBe('Work');
    expect(await fixture.registry.getAccount('linear', first.accountId)).toEqual(saved);
  });
});
