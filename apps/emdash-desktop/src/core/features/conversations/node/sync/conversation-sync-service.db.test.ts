import { setImmediate } from 'node:timers/promises';
import { formatHostRef, hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import {
  acpApiContract,
  initialSessionConfigState,
  type SessionConfigState,
  type SessionSummary,
} from '@emdash/core/runtimes/acp/api/client';
import {
  conversationsContract,
  type ConversationRecord,
  type ConversationRecords,
} from '@emdash/core/runtimes/conversations/api';
import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { deferred } from '@emdash/shared/testing';
import { createController, defineContract } from '@emdash/wire/rpc';
import { cell, expose, type Cell } from '@emdash/wire/state';
import { createTestWire, type TestWire } from '@emdash/wire/testing';
import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversationRegistry } from '@core/features/conversations/api/node/registry';
import { sshConnections } from '@core/services/app-db/node/schema';
import { getProviderSettingsService } from '../provider-settings-service';
import { ConversationSyncService } from './conversation-sync-service';

function hostRecord(
  overrides: Partial<ConversationRecord> & { conversationId: string }
): ConversationRecord {
  return {
    provider: 'claude-code',
    type: 'acp',
    cwd: '/work/repo',
    workspacePath: '/work/repo',
    idRegime: 'emdash-chosen',
    createdAt: Date.parse('2026-01-01T00:00:00.000Z'),
    title: 'Host truth',
    config: { model: 'sonnet' },
    providerSessionId: null,
    providerSessionIdObservedAt: null,
    lastSessionActivityAt: null,
    lastSpawnedAt: null,
    lastResumeOutcome: 'never-resumed',
    updatedAt: Date.parse('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

function createAcpHost() {
  const contract = defineContract({
    sessions: acpApiContract.sessions,
    session: acpApiContract.session,
  });
  const config = cell<SessionConfigState>(initialSessionConfigState);
  const summary: SessionSummary = {
    conversationId: 'headless',
    providerId: 'codex',
    lifecycle: 'ready',
    isGenerating: false,
    lastStopReason: null,
    lastTurnErrored: false,
    pendingPermissionCount: 0,
    backgroundAgentCount: 0,
    queuedPromptCount: 0,
    title: null,
    updatedAt: 1,
  };
  const sessions = expose(contract.sessions, { list: () => cell({ headless: summary }) });
  const unused = () => {
    throw new Error('Only config is observed');
  };
  const session = expose(contract.session, {
    config: () => config,
    state: unused,
    usage: unused,
    plan: unused,
    agents: unused,
    terminals: unused,
    mcpServers: unused,
  });
  const wire = createTestWire(contract, createController(contract, { sessions, session }));
  return {
    config,
    client: wire.client,
    async dispose() {
      await sessions.dispose();
      await session.dispose();
      await wire.dispose();
    },
  };
}

/**
 * End-to-end convergence: a fake host serves the `records` live model over a test wire
 * (the same `expose`-over-a-cell shape the real runtime uses), and the sync service
 * converges the client registry (real SQLite) toward it. The cache is never the
 * authority (`conv.cache-not-authority`); the subscription is the only thing that
 * moves it. The mutation verbs are stubbed because the sync path never calls them.
 */
describe('ConversationSyncService', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;
  let hostRecords: Cell<ConversationRecords>;
  let recordsHost: ReturnType<typeof expose<typeof conversationsContract.records>>;
  let wire: TestWire<typeof conversationsContract>;
  let service: ConversationSyncService;
  let hostReachable: boolean;
  let acpClient: unknown;
  let patchConfig: ReturnType<typeof vi.fn<() => never>>;

  beforeEach(async () => {
    fixture = await openFixture('empty');
    hostRecords = cell<ConversationRecords>({}, { name: 'test-conversation-records' });
    recordsHost = expose(conversationsContract.records, { list: () => hostRecords });
    const unused = () => {
      throw new Error('not exercised by the sync service');
    };
    patchConfig = vi.fn(unused);
    wire = createTestWire(
      conversationsContract,
      createController(conversationsContract, {
        records: recordsHost,
        create: unused,
        rename: unused,
        patchConfig,
        delete: unused,
        reports: {
          sessionStarted: unused,
          providerSessionId: unused,
          sessionActivity: unused,
          sessionEnded: unused,
        },
      })
    );
    hostReachable = true;
    acpClient = undefined;
    const broker = {
      client: async () =>
        hostReachable
          ? { success: true, data: { conversations: wire.client, acp: acpClient } }
          : { success: false, error: { type: 'host-unavailable' } },
    } as unknown as RuntimeBroker;
    service = new ConversationSyncService({ db: fixture.db, runtimes: broker });
  });

  afterEach(async () => {
    service.dispose();
    await recordsHost.dispose();
    await wire.dispose();
    await getProviderSettingsService(fixture.db).dispose();
    fixture.close();
  });

  function registry() {
    return createConversationRegistry(fixture.db);
  }

  function setHostRecords(...records: ConversationRecord[]): void {
    hostRecords.set(Object.fromEntries(records.map((record) => [record.conversationId, record])));
  }

  it('discovers remote options without a renderer and keeps them when the host disconnects', async () => {
    const acp = createAcpHost();
    const { config } = acp;
    acpClient = acp.client;
    const remoteHost = hostRef('remote', 'model-server');
    const key = { host: formatHostRef(remoteHost), providerId: 'codex' };
    const settings = getProviderSettingsService(fixture.db);
    try {
      await settings.patch(key, { transport: 'acp', options: { model: 'user-choice' } });
      await service.attachHost(remoteHost);
      const option = {
        id: 'model',
        type: 'select' as const,
        name: 'Model',
        category: 'model',
        currentValue: 'remote-cli-default',
        options: [{ value: 'remote-cli-default', name: 'Remote model' }],
      };
      config.set({
        ...initialSessionConfigState,
        discoveryContext: 'remote-env',
        options: [option],
      });
      await vi.waitFor(async () => expect((await settings.read(key)).catalogs).toEqual([[option]]));
      const localKey = { ...key, host: formatHostRef(LOCAL_HOST_REF) };
      expect((await settings.read(localKey)).catalogs).toEqual([[option]]);
      expect((await settings.read(localKey)).acp.options).toEqual({});
      expect((await settings.read(key)).acp.options).toEqual({ model: 'user-choice' });
      service.detachHost(remoteHost);
      hostReachable = false;
      await service.attachHost(remoteHost);
      expect((await settings.read(key)).catalogs).toEqual([[option]]);
      expect((await settings.read(localKey)).catalogs).toEqual([[option]]);
    } finally {
      service.detachHost(remoteHost);
      await acp.dispose();
    }
  });

  it('discards queued observations and pending cleanup from a replaced host attachment', async () => {
    fixture.db
      .insert(sshConnections)
      .values({ id: 'model-server', name: 'Model server', host: 'test-host', username: 'test' })
      .run();
    const acp = createAcpHost();
    acpClient = acp.client;
    const remoteHost = hostRef('remote', 'model-server');
    const key = { host: formatHostRef(remoteHost), providerId: 'codex' };
    const settings = getProviderSettingsService(fixture.db);
    const saved = deferred<void>();
    const release = deferred<void>();
    const observeCatalog = settings.observeCatalog.bind(settings);
    const observe = vi.spyOn(settings, 'observeCatalog').mockImplementationOnce(async (...args) => {
      await observeCatalog(...args);
      saved.resolve();
      await release.promise;
    });
    const config = (model: string, clearedOptions = {}): SessionConfigState => ({
      ...initialSessionConfigState,
      discoveryContext: 'remote-env',
      options: [
        {
          id: 'model',
          type: 'select',
          name: 'Model',
          category: 'model',
          currentValue: model,
          options: [{ value: model, name: model }],
        },
      ],
      clearedOptions,
    });
    try {
      await settings.patch(key, { transport: 'acp', options: { model: 'user-choice' } });
      await service.attachHost(remoteHost);
      acp.config.set(config('old-active', { model: 'obsolete' }));
      await saved.promise;

      acp.config.set(config('old-queued', { model: 'user-choice' }));
      setHostRecords(hostRecord({ conversationId: 'headless', title: 'Old attachment' }));
      // Flush in-process Wire deliveries into the queue while the previous save is held.
      await setImmediate();
      service.detachHost(remoteHost);
      acp.config.set(config('fresh'));
      setHostRecords(hostRecord({ conversationId: 'headless', title: 'New attachment' }));
      await service.attachHost(remoteHost);
      await vi.waitFor(async () =>
        expect((await settings.read(key)).catalogs[0]).toEqual(config('fresh').options)
      );
      expect(registry().getLive('headless')?.title).toBe('New attachment');

      release.resolve();
      await setImmediate();
      const current = await settings.read(key);
      expect.soft(current.catalogs[0]).toEqual(config('fresh').options);
      expect.soft(current.acp.options).toEqual({ model: 'user-choice' });
      expect.soft(observe).toHaveBeenCalledTimes(2);
      expect.soft(patchConfig).not.toHaveBeenCalled();
      expect(registry().getLive('headless')?.title).toBe('New attachment');
    } finally {
      release.resolve();
      await setImmediate();
      observe.mockRestore();
      service.detachHost(remoteHost);
      await acp.dispose();
    }
  });

  it('applies initial host state and then diffs through the same path', async () => {
    setHostRecords(hostRecord({ conversationId: 'conv-1', title: 'Pre-existing' }));

    await service.attachHost(LOCAL_HOST_REF);
    await vi.waitFor(() => {
      expect(registry().getLive('conv-1')).toMatchObject({
        title: 'Pre-existing',
        origin: 'adopted',
        observedStatus: 'present',
        location: 'local',
      });
    });

    // Subsequent host mutations arrive as diffs and route through the same verbs.
    setHostRecords(
      hostRecord({ conversationId: 'conv-1', title: 'Renamed on host' }),
      hostRecord({ conversationId: 'conv-2', title: 'Born after attach' })
    );
    await vi.waitFor(() => {
      expect(registry().getLive('conv-2')).toMatchObject({ title: 'Born after attach' });
      expect(registry().getLive('conv-1')).toMatchObject({ title: 'Renamed on host' });
    });
  });

  it('loses nothing across kill-and-resubscribe: reattach replays full state', async () => {
    setHostRecords(hostRecord({ conversationId: 'conv-1', title: 'First' }));
    await service.attachHost(LOCAL_HOST_REF);
    await vi.waitFor(() => expect(registry().getLive('conv-1')).toBeDefined());

    service.detachHost(LOCAL_HOST_REF);
    // Mutations while detached are invisible to the client...
    setHostRecords(
      hostRecord({ conversationId: 'conv-1', title: 'Renamed while detached' }),
      hostRecord({ conversationId: 'conv-2', title: 'While detached' })
    );
    expect(registry().getLive('conv-2')).toBeUndefined();

    // ...and the reattach's initial state alone recovers everything.
    await service.attachHost(LOCAL_HOST_REF);
    await vi.waitFor(() => {
      expect(registry().getLive('conv-2')).toMatchObject({ title: 'While detached' });
      expect(registry().getLive('conv-1')).toMatchObject({ title: 'Renamed while detached' });
    });
  });

  it('serves cached observations when the host is unreachable; nothing errors, nothing sweeps', async () => {
    setHostRecords(hostRecord({ conversationId: 'conv-1', title: 'Cached' }));
    await service.attachHost(LOCAL_HOST_REF);
    await vi.waitFor(() => expect(registry().getLive('conv-1')).toBeDefined());
    service.detachHost(LOCAL_HOST_REF);

    hostReachable = false;
    await service.attachHost(LOCAL_HOST_REF);

    // No subscription, no sweep: the cached row keeps serving with its last observation.
    const cached = registry().getLive('conv-1');
    expect(cached).toMatchObject({ title: 'Cached', observedStatus: 'present' });
    expect(cached?.lastObservedAt).not.toBeNull();
  });
});
