import { formatHostRef, hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import {
  initialSessionConfigState,
  type ProviderConfigOption,
} from '@emdash/core/runtimes/acp/api/client';
import { createScope } from '@emdash/shared/concurrency';
import { createController, defineContract } from '@emdash/wire/rpc';
import { remote, snapshot, whenReady } from '@emdash/wire/state';
import { createTestWire } from '@emdash/wire/testing';
import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDbKeyValueStore } from '@core/services/app-db/node/key-value-store';
import { conversationsContract } from '../api/contract';
import { ProviderSettingsService } from './provider-settings-service';

const local = { host: formatHostRef(LOCAL_HOST_REF), providerId: 'codex' };
const remoteScope = { ...local, host: formatHostRef(hostRef('remote', 'server-a')) };
const model = (value: string): ProviderConfigOption => ({
  id: 'model',
  name: 'Model',
  category: 'model',
  type: 'select',
  currentValue: value,
  options: [{ name: value, value }],
});

describe('provider settings persistence', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;
  let service: ProviderSettingsService;
  beforeEach(async () => {
    fixture = await openFixture('empty');
    service = new ProviderSettingsService(fixture.db);
  });
  afterEach(async () => {
    await service.dispose();
    fixture.close();
  });

  it('starts with provider defaults and remembers explicit choices across service restarts', async () => {
    expect((await service.read(local)).acp).toEqual({
      version: '1',
      options: {},
    });
    await service.patch(local, {
      transport: 'acp',
      options: { model: 'astra', effort: 'xhigh', fast: false },
    });
    await service.dispose();
    service = new ProviderSettingsService(fixture.db);
    expect(await service.read(local)).toMatchObject({
      acp: { options: { model: 'astra', effort: 'xhigh', fast: false } },
    });
  });

  it('publishes edits to all subscribed creation scopes over Wire', async () => {
    const contract = defineContract({ providerSettings: conversationsContract.providerSettings });
    const wire = createTestWire(
      contract,
      createController(contract, {
        providerSettings: {
          model: service.model,
          patch: ({ patch, ...key }) => service.patch(key, patch),
        },
      })
    );
    const scope = createScope();
    const model = remote(contract.providerSettings.model, wire.client.providerSettings.model, {
      scope,
    });
    const task = model(local).states.value;
    const conversation = model({ ...local }).states.value;
    try {
      await Promise.all([whenReady(task, { scope }), whenReady(conversation, { scope })]);
      await wire.client.providerSettings.patch({
        ...local,
        patch: { transport: 'acp', options: { effort: 'xhigh' } },
      });
      await vi.waitFor(() => {
        expect(snapshot(task).value?.acp.options).toEqual({ effort: 'xhigh' });
        expect(snapshot(conversation).value?.acp.options).toEqual({ effort: 'xhigh' });
      });
    } finally {
      await scope.dispose();
      await wire.dispose();
    }
  });

  it('isolates preferences by host, provider, and transport', async () => {
    await service.patch(local, { transport: 'acp', options: { model: 'new-cli-model' } });
    for (const key of [remoteScope, { ...local, providerId: 'claude' }])
      expect((await service.read(key)).acp.options).toEqual({});
    expect((await service.read(local)).pty).toEqual({ version: '1', autoApprove: false });
    await service.patch(local, {
      transport: 'pty',
      autoApprove: true,
    });
    expect((await service.read(local)).pty).toEqual({ version: '1', autoApprove: true });
  });

  it('merges concurrent field patches and remembers native default choices', async () => {
    await Promise.all([
      service.patch(local, { transport: 'acp', options: { model: 'astra' } }),
      service.patch(local, { transport: 'acp', options: { effort: 'xhigh' } }),
      service.patch(local, { transport: 'pty', autoApprove: true }),
    ]);
    await service.patch(local, { transport: 'acp', options: { model: 'default' } });
    expect((await service.read(local)).acp).toEqual({
      version: '1',
      options: { model: 'default', effort: 'xhigh' },
    });
  });

  it('does not replace preferences with defaults after a failed database read', async () => {
    await service.patch(local, { transport: 'acp', options: { effort: 'xhigh' } });
    const read = vi.spyOn(fixture.db, 'select').mockImplementationOnce(() => {
      throw new Error('database unavailable');
    });
    await expect(
      service.patch(local, { transport: 'acp', options: { model: 'astra' } })
    ).rejects.toThrow('database unavailable');
    read.mockRestore();
    expect((await service.read(local)).acp).toEqual({
      version: '1',
      options: { effort: 'xhigh' },
    });
  });

  it('rejects invalid preference records without overwriting stored selections', async () => {
    const preferences = new AppDbKeyValueStore<Record<string, unknown>>(
      fixture.db,
      'provider-preferences'
    );
    const key = JSON.stringify([local.host, local.providerId, 'acp']);
    const invalid = { version: '1', options: { model: 'astra', effort: 123 } };
    await preferences.setOrThrow(key, invalid);

    await expect(
      service.patch(local, { transport: 'acp', options: { fast: true } })
    ).rejects.toThrow();
    await expect(service.read(local)).rejects.toThrow();
    expect(await preferences.getOrThrow(key)).toEqual(invalid);
  });

  it('caches actual per-host catalogs without turning observations into preferences', async () => {
    await service.observeCatalog(local, {
      ...initialSessionConfigState,
      discoveryContext: 'workspace/env-a',
      options: [model('new-cli')],
    });
    await service.observeCatalog(remoteScope, {
      ...initialSessionConfigState,
      discoveryContext: 'workspace/env-a',
      options: [model('old-cli')],
    });
    expect((await service.read(local)).catalogs).toEqual([[model('new-cli')]]);
    expect((await service.read(remoteScope)).catalogs).toEqual([[model('old-cli')]]);
    expect((await service.read(local)).acp.options).toEqual({});
    await service.observeCatalog(local, initialSessionConfigState);
    expect((await service.read(local)).catalogs).toEqual([[model('new-cli')]]);
  });

  it('borrows the most recently observed host catalog without borrowing preferences', async () => {
    const otherHost = { ...local, host: formatHostRef(hostRef('remote', 'server-b')) };
    const now = vi.spyOn(Date, 'now');
    try {
      await service.patch(local, { transport: 'acp', options: { model: 'local-choice' } });
      await service.patch(local, { transport: 'pty', autoApprove: true });
      await service.patch(remoteScope, { transport: 'acp', options: { effort: 'high' } });
      now.mockReturnValue(1_000);
      await service.observeCatalog(local, {
        ...initialSessionConfigState,
        discoveryContext: 'project-a/env',
        options: [model('a')],
      });
      now.mockReturnValue(2_000);
      await service.observeCatalog(otherHost, {
        ...initialSessionConfigState,
        discoveryContext: 'project-b/env',
        options: [model('b')],
      });
      now.mockReturnValue(3_000);
      await service.observeCatalog(otherHost, {
        ...initialSessionConfigState,
        discoveryContext: 'project-c/env',
        options: [model('c')],
      });
      // A different transport must not supply options, even if it has a newer entry.
      now.mockReturnValue(3_500);
      await new AppDbKeyValueStore<Record<string, unknown>>(
        fixture.db,
        'provider-options'
      ).setOrThrow(
        JSON.stringify([remoteScope.host, remoteScope.providerId, 'pty', 'configuration']),
        { version: '1', options: [model('tui-only')] }
      );
      const borrowed = await service.read(remoteScope);
      expect(borrowed.catalogs).toEqual([[model('c')], [model('b')]]);
      expect(borrowed.acp.options).toEqual({ effort: 'high' });
      expect(borrowed.pty.autoApprove).toBe(false);
      expect((await service.read(local)).catalogs).toEqual([[model('a')]]);
      expect((await service.read({ ...remoteScope, providerId: 'claude' })).catalogs).toEqual([]);

      await service.patch(remoteScope, { transport: 'acp', options: { model: 'b' } });
      await service.observeCatalog(remoteScope, initialSessionConfigState);
      expect((await service.read(remoteScope)).acp.options).toEqual({ model: 'b', effort: 'high' });
      expect((await service.read(remoteScope)).catalogs).toEqual(borrowed.catalogs);
      expect((await service.read(local)).acp.options).toEqual({ model: 'local-choice' });
      expect((await service.read(otherHost)).acp.options).toEqual({});

      now.mockReturnValue(4_000);
      await service.observeCatalog(remoteScope, {
        ...initialSessionConfigState,
        discoveryContext: 'target/env',
        options: [model('target')],
        clearedOptions: { model: 'b' },
      });
      expect((await service.read(remoteScope)).catalogs).toEqual([[model('target')]]);
      expect((await service.read(remoteScope)).acp.options).toEqual({ effort: 'high' });
      expect((await service.read(otherHost)).catalogs).toEqual(borrowed.catalogs);
    } finally {
      now.mockRestore();
    }
  });

  it('treats a successfully discovered empty catalog as authoritative for its host', async () => {
    await service.observeCatalog(local, {
      ...initialSessionConfigState,
      discoveryContext: 'context',
      options: [model('a')],
    });
    expect((await service.read(remoteScope)).catalogs).toEqual([[model('a')]]);
    await service.observeCatalog(remoteScope, {
      ...initialSessionConfigState,
      discoveryContext: 'context',
      options: [],
    });
    expect((await service.read(remoteScope)).catalogs).toEqual([[]]);
  });

  it('refreshes open forms when borrowed catalogs change, then prefers their own host', async () => {
    const contract = defineContract({ providerSettings: conversationsContract.providerSettings });
    const wire = createTestWire(
      contract,
      createController(contract, {
        providerSettings: {
          model: service.model,
          patch: ({ patch, ...key }) => service.patch(key, patch),
        },
      })
    );
    const scope = createScope();
    const settings = remote(contract.providerSettings.model, wire.client.providerSettings.model, {
      scope,
    });
    const state = settings(remoteScope).states.value;
    const now = vi.spyOn(Date, 'now');
    try {
      await whenReady(state, { scope });
      expect(snapshot(state).value?.catalogs).toEqual([]);
      now.mockReturnValue(1_000);
      await service.observeCatalog(local, {
        ...initialSessionConfigState,
        discoveryContext: 'context',
        options: [model('a')],
      });
      await vi.waitFor(() => expect(snapshot(state).value?.catalogs).toEqual([[model('a')]]));
      now.mockReturnValue(2_000);
      await service.observeCatalog(local, {
        ...initialSessionConfigState,
        discoveryContext: 'context',
        options: [model('b')],
      });
      await vi.waitFor(() =>
        expect(snapshot(state).value?.catalogs).toEqual([[model('b')], [model('a')]])
      );
      now.mockReturnValue(3_000);
      await service.observeCatalog(remoteScope, {
        ...initialSessionConfigState,
        discoveryContext: 'context',
        options: [model('target')],
      });
      await vi.waitFor(() => expect(snapshot(state).value?.catalogs).toEqual([[model('target')]]));
      now.mockReturnValue(4_000);
      await service.observeCatalog(local, {
        ...initialSessionConfigState,
        discoveryContext: 'context',
        options: [model('c')],
      });
      expect((await service.read(remoteScope)).catalogs).toEqual([[model('target')]]);
      expect(snapshot(state).value?.acp.options).toEqual({});
    } finally {
      now.mockRestore();
      await scope.dispose();
      await wire.dispose();
    }
  });

  it('keeps configuration variants and clears only the still-invalid saved choices', async () => {
    await service.patch(local, {
      transport: 'acp',
      options: { model: 'removed', effort: 'new-choice' },
    });
    await service.observeCatalog(local, {
      ...initialSessionConfigState,
      discoveryContext: 'context',
      options: [model('a')],
      clearedOptions: { model: 'removed', effort: 'old-choice' },
    });
    await service.observeCatalog(local, {
      ...initialSessionConfigState,
      discoveryContext: 'context',
      options: [model('b')],
    });
    expect((await service.read(local)).catalogs).toHaveLength(2);
    expect((await service.read(local)).acp.options).toEqual({ effort: 'new-choice' });
  });

  it('shares catalogs across project contexts and refreshes their recency after restart', async () => {
    const now = vi.spyOn(Date, 'now');
    const observe = (value: string, discoveryContext: string) =>
      service.observeCatalog(local, {
        ...initialSessionConfigState,
        discoveryContext,
        options: [model(value)],
      });
    try {
      now.mockReturnValue(1_000);
      await observe('a', 'project-a/env');
      now.mockReturnValue(2_000);
      await observe('b', 'project-b/env');
      now.mockReturnValue(3_000);
      await observe('a', 'project-c/env');
      await service.dispose();
      service = new ProviderSettingsService(fixture.db);
      expect((await service.read(local)).catalogs).toEqual([[model('a')], [model('b')]]);
      expect((await service.read(remoteScope)).catalogs).toEqual([[model('a')], [model('b')]]);
      expect((await service.read(local)).acp.options).toEqual({});
    } finally {
      now.mockRestore();
    }
  });
});
