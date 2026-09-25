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
import { conversationsContract } from '../api/contract';
import { ProviderSettingsService } from './provider-settings-service';

const local = { host: formatHostRef(LOCAL_HOST_REF), providerId: 'codex', projectId: 'project-a' };
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
    const conversation = model({ ...local, projectId: 'project-b' }).states.value;
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

  it('isolates hosts, providers, and transports while sharing preferences across projects', async () => {
    await service.patch(local, { transport: 'acp', options: { model: 'new-cli-model' } });
    for (const key of [remoteScope, { ...local, providerId: 'claude' }])
      expect((await service.read(key)).acp.options).toEqual({});
    expect((await service.read(local)).pty).toEqual({ version: '1', autoApprove: false });
    expect((await service.read({ ...local, projectId: 'project-b' })).acp.options).toEqual({
      model: 'new-cli-model',
    });
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

  it('refreshes catalog recency when a previous configuration is observed again', async () => {
    const now = vi.spyOn(Date, 'now');
    const observe = (value: string) =>
      service.observeCatalog(local, {
        ...initialSessionConfigState,
        discoveryContext: 'context',
        options: [model(value)],
      });
    try {
      now.mockReturnValue(1_000);
      await observe('a');
      now.mockReturnValue(2_000);
      await observe('b');
      now.mockReturnValue(3_000);
      await observe('a');
      await service.dispose();
      service = new ProviderSettingsService(fixture.db);
      expect((await service.read(local)).catalogs).toEqual([[model('a')], [model('b')]]);
      expect((await service.read(remoteScope)).catalogs).toEqual([]);
      expect((await service.read({ ...local, projectId: 'other' })).catalogs).toEqual([]);
      expect((await service.read(local)).acp.options).toEqual({});
    } finally {
      now.mockRestore();
    }
  });
});
