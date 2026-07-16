import type { MobileAcpSnapshot, MobileCatalog, MobileResource } from '@emdash/core/mobile-access';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BrowserMobileClient,
  mapCatalog,
  mapAcpHandle,
  replaceCatalogTask,
  toWebSocketUrl,
} from './browser-client';
import type { ResourceSummary } from './types';

type TestOpenResource = {
  resourceId?: string;
  kind?: 'acp' | 'conversation' | 'terminal';
  serverHandleId?: string;
};

type RehydrateTestClient = {
  rehydrateOpenResources(generation: number, wire: unknown): Promise<void>;
  invalidateConnection(): number;
};

type SnapshotTestClient = {
  loadAcpSnapshot(handleId: string, wire: unknown): Promise<MobileAcpSnapshot>;
};

type SessionCheckTestClient = {
  scheduleSessionCheck(): void;
};

type CatalogPollTestClient = {
  pollCatalog(): Promise<void>;
};

const terminalResource = (id: string): MobileResource => ({
  kind: 'terminal',
  id,
  projectId: 'project-one',
  taskId: 'task-one',
  title: id,
  shellId: 'system',
  runtimeAvailable: true,
});

const acpResource = (id: string): MobileResource => ({
  kind: 'acp',
  id,
  projectId: 'project-one',
  taskId: 'task-one',
  title: id,
  providerId: 'codex',
  status: null,
  seen: true,
  runtimeAvailable: true,
});

function ok<T>(data: T): { success: true; data: T } {
  return { success: true, data };
}

function failure(message: string): {
  success: false;
  error: { code: 'runtime_error'; message: string };
} {
  return { success: false, error: { code: 'runtime_error', message } };
}

function privateValue<T>(client: BrowserMobileClient, key: string): T {
  return Reflect.get(client, key) as T;
}

function setPrivate(client: BrowserMobileClient, key: string, value: unknown): void {
  Reflect.set(client, key, value);
}

function prepareClient(wire: unknown): BrowserMobileClient {
  const client = new BrowserMobileClient();
  setPrivate(client, 'authenticated', true);
  setPrivate(client, 'wire', wire);
  return client;
}

function indexResource(client: BrowserMobileClient, resource: MobileResource): ResourceSummary {
  return (
    client as unknown as {
      indexCatalogResource(value: MobileResource): ResourceSummary;
    }
  ).indexCatalogResource(resource);
}

function rehydrateClient(client: BrowserMobileClient): RehydrateTestClient {
  return client as unknown as RehydrateTestClient;
}

function snapshotClient(client: BrowserMobileClient): SnapshotTestClient {
  return client as unknown as SnapshotTestClient;
}

function sessionCheckClient(client: BrowserMobileClient): SessionCheckTestClient {
  return client as unknown as SessionCheckTestClient;
}

function catalogPollClient(client: BrowserMobileClient): CatalogPollTestClient {
  return client as unknown as CatalogPollTestClient;
}

function acpSnapshot(
  history: MobileAcpSnapshot['history'] = { turns: [], nextCursor: null }
): MobileAcpSnapshot {
  return {
    history,
    state: {
      isGenerating: false,
      queuedPrompts: [],
      pendingPermissions: [],
    },
    config: {},
    usage: null,
    plan: null,
    agents: [],
    activeTurn: null,
    draftRev: null,
    draft: null,
    terminals: [],
  } as unknown as MobileAcpSnapshot;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      resolvePromise?.(value);
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('window', {
    location: { href: 'http://192.168.1.10:7458/', reload: vi.fn() },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setTimeout: vi.fn(() => 1),
    clearTimeout: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('browser mobile client helpers', () => {
  it('derives same-origin websocket URLs', () => {
    expect(toWebSocketUrl('http://192.168.1.10:7458/tasks', '/mobile-api/socket')).toBe(
      'ws://192.168.1.10:7458/mobile-api/socket'
    );
    expect(toWebSocketUrl('https://emdash.tailnet.ts.net/', '/mobile-api/socket')).toBe(
      'wss://emdash.tailnet.ts.net/mobile-api/socket'
    );
  });

  it('replaces only the requested catalog task count', () => {
    const original = {
      projects: [],
      tasks: [
        {
          id: 'one',
          projectId: 'p',
          name: 'One',
          status: 'ready' as const,
          counts: { conversations: 1 },
        },
        {
          id: 'two',
          projectId: 'p',
          name: 'Two',
          status: 'ready' as const,
          counts: { conversations: 2 },
        },
      ],
    };
    const next = replaceCatalogTask(original, 'one', 3);
    expect(next.tasks[0].counts.conversations).toBe(3);
    expect(next.tasks[1]).toBe(original.tasks[1]);
  });

  it('maps not-started tasks to the selectable dormant state', () => {
    const catalog: MobileCatalog = {
      revision: 1,
      projects: [{ id: 'project-one', name: 'Project', kind: 'local' }],
      tasks: [
        {
          id: 'task-one',
          projectId: 'project-one',
          name: 'Task',
          lifecycleStatus: 'active',
          bootstrapStatus: 'not-started',
          updatedAt: '2026-07-15T00:00:00.000Z',
        },
      ],
      resources: [],
    };

    expect(mapCatalog(catalog).tasks[0]?.status).toBe('dormant');
  });

  it('preserves queued prompt metadata and ACP terminal output in mapped handles', () => {
    const snapshot = acpSnapshot();
    snapshot.state.queuedPrompts = [
      {
        id: 'queued-one',
        text: 'Visible instruction',
        hiddenContext: 'Private context',
        attachments: [
          {
            type: 'attachment',
            id: 'attachment-one',
            name: 'diagram.png',
            mimeType: 'image/png',
          },
        ],
        createdAt: 1,
        updatedAt: 2,
      },
    ];
    snapshot.terminals = [
      {
        terminalId: 'tool-terminal',
        command: 'pnpm',
        args: ['test'],
        cwd: '/workspace',
        output: 'all tests passed',
        truncated: false,
        exitStatus: null,
      },
    ];
    snapshot.draftRev = 7;
    snapshot.draft = {
      rev: 7,
      updatedAt: 3,
      text: 'Draft text',
      hiddenContext: 'Draft context',
      attachments: [
        {
          type: 'attachment',
          id: 'draft-attachment',
          name: 'draft.png',
          mimeType: 'image/png',
        },
      ],
    };

    const handle = mapAcpHandle(
      'handle-one',
      {
        id: 'acp-one',
        taskId: 'task-one',
        kind: 'acp',
        title: 'Agent',
      },
      snapshot,
      []
    );

    expect(handle.queue).toEqual([
      {
        id: 'queued-one',
        text: 'Visible instruction',
        hiddenContext: 'Private context',
        attachments: [
          {
            type: 'attachment',
            id: 'attachment-one',
            name: 'diagram.png',
            mimeType: 'image/png',
          },
        ],
      },
    ]);
    expect(handle.terminalOutputs).toEqual([
      { terminalId: 'tool-terminal', output: 'all tests passed' },
    ]);
    expect(handle.draft).toEqual({
      revision: 7,
      text: 'Draft text',
      hiddenContext: 'Draft context',
      attachments: [
        {
          type: 'attachment',
          id: 'draft-attachment',
          name: 'draft.png',
          mimeType: 'image/png',
        },
      ],
    });
  });
});

describe('browser mobile client sessions', () => {
  it('treats an unauthenticated session response as a valid bootstrap state', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ authenticated: false }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new BrowserMobileClient();

    await expect(client.bootstrap()).resolves.toEqual({ authenticated: false });
    expect(client.connectionStatus).toBe('online');
  });

  it('reloads to pairing when a reconnect session check returns 401', async () => {
    let callback: (() => void) | undefined;
    vi.mocked(window.setTimeout).mockImplementation((handler: TimerHandler) => {
      callback = handler as () => void;
      return 1 as unknown as ReturnType<typeof window.setTimeout>;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ authenticated: false }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          })
      )
    );
    const client = prepareClient({});
    client.connectionStatus = 'reconnecting';

    sessionCheckClient(client).scheduleSessionCheck();
    callback?.();

    await vi.waitFor(() => expect(window.location.reload).toHaveBeenCalledOnce());
    expect(privateValue(client, 'authenticated')).toBe(false);
  });

  it('emits catalog changes only when the server revision advances', async () => {
    const initial: MobileCatalog = { revision: 1, projects: [], tasks: [], resources: [] };
    const next: MobileCatalog = { revision: 2, projects: [], tasks: [], resources: [] };
    const wire = { catalog: vi.fn(async () => ok(next)) };
    const client = prepareClient(wire);
    setPrivate(client, 'serverCatalog', initial);
    const listener = vi.fn();
    client.subscribe(listener);

    await catalogPollClient(client).pollCatalog();
    await catalogPollClient(client).pollCatalog();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      type: 'catalog.changed',
      catalog: { projects: [], tasks: [] },
    });
  });
});

describe('browser mobile client ACP operations', () => {
  it('sends all queued prompt fields when editing its text', async () => {
    const editQueuedPrompt = vi.fn(async () => ok(undefined));
    const wire = { acp: { editQueuedPrompt } };
    const client = prepareClient(wire);
    privateValue<Map<string, TestOpenResource>>(client, 'openResources').set('ui-handle', {
      serverHandleId: 'server-handle',
    });
    const input = {
      text: 'Updated text',
      hiddenContext: 'Keep this context',
      attachments: [
        {
          type: 'attachment' as const,
          id: 'attachment-one',
          name: 'diagram.png',
          mimeType: 'image/png' as const,
        },
      ],
    };

    await client.editQueuedPrompt('ui-handle', 'queued-one', input);

    expect(editQueuedPrompt).toHaveBeenCalledWith({
      handleId: 'server-handle',
      id: 'queued-one',
      input,
    });
  });

  it('maps the desktop auto-approve creation default', async () => {
    const wire = {
      creationOptions: vi.fn(async () =>
        ok({
          defaultAgentId: 'codex',
          defaultShellId: 'system',
          autoApproveByDefault: true,
          agents: [],
          shells: [],
        })
      ),
    };
    const client = prepareClient(wire);

    await expect(client.getCreateOptions('task-one')).resolves.toMatchObject({
      autoApproveByDefault: true,
    });
  });

  it('preserves draft metadata in compare-and-set updates', async () => {
    const setDraft = vi.fn(async () =>
      ok({
        status: 'applied' as const,
        rev: 9,
        draft: {
          rev: 9,
          updatedAt: 10,
          text: 'Updated draft',
          hiddenContext: 'Keep draft context',
          attachments: [
            {
              type: 'attachment' as const,
              id: 'draft-attachment',
              name: 'draft.png',
              mimeType: 'image/png' as const,
            },
          ],
        },
      })
    );
    const client = prepareClient({ acp: { setDraft } });
    privateValue<Map<string, TestOpenResource>>(client, 'openResources').set('ui-handle', {
      serverHandleId: 'server-handle',
    });
    const input = {
      text: 'Updated draft',
      hiddenContext: 'Keep draft context',
      attachments: [
        {
          type: 'attachment' as const,
          id: 'draft-attachment',
          name: 'draft.png',
          mimeType: 'image/png' as const,
        },
      ],
    };

    await expect(client.updateDraft('ui-handle', 8, input)).resolves.toEqual({
      accepted: true,
      current: { revision: 9, ...input },
    });
    expect(setDraft).toHaveBeenCalledWith({
      handleId: 'server-handle',
      expectedRev: 8,
      input,
    });
  });

  it('combines preserved draft refs with newly uploaded phone attachments', async () => {
    const uploadAttachment = vi.fn(async () =>
      ok({ id: 'phone-upload', name: 'phone.png', mimeType: 'image/png' as const })
    );
    const sendPrompt = vi.fn(async () => ok(undefined));
    const client = prepareClient({
      acp: { uploadAttachment, sendPrompt, deleteAttachment: vi.fn() },
    });
    privateValue<Map<string, TestOpenResource>>(client, 'openResources').set('ui-handle', {
      serverHandleId: 'server-handle',
    });

    await client.sendPrompt(
      'ui-handle',
      {
        text: 'Send this',
        hiddenContext: 'Draft context',
        attachments: [
          {
            type: 'attachment',
            id: 'desktop-ref',
            name: 'desktop.png',
            mimeType: 'image/png',
          },
        ],
      },
      [
        {
          id: 'local-phone',
          name: 'phone.png',
          mimeType: 'image/png',
          bytes: new Uint8Array([1, 2, 3]),
        },
      ]
    );

    expect(sendPrompt).toHaveBeenCalledWith({
      handleId: 'server-handle',
      prompt: {
        text: 'Send this',
        hiddenContext: 'Draft context',
        attachments: [
          {
            type: 'attachment',
            id: 'desktop-ref',
            name: 'desktop.png',
            mimeType: 'image/png',
          },
          {
            type: 'attachment',
            id: 'phone-upload',
            name: 'phone.png',
            mimeType: 'image/png',
          },
        ],
      },
    });
  });

  it('deletes earlier uploads if a later attachment upload fails', async () => {
    const uploadAttachment = vi
      .fn()
      .mockResolvedValueOnce(
        ok({ id: 'uploaded-first', name: 'first.png', mimeType: 'image/png' as const })
      )
      .mockResolvedValueOnce(failure('second upload failed'));
    const deleteAttachment = vi.fn(async () => ok(undefined));
    const sendPrompt = vi.fn(async () => ok(undefined));
    const client = prepareClient({ acp: { uploadAttachment, deleteAttachment, sendPrompt } });
    privateValue<Map<string, TestOpenResource>>(client, 'openResources').set('ui-handle', {
      serverHandleId: 'server-handle',
    });
    const attachments = ['first.png', 'second.png'].map((name, index) => ({
      id: `local-${index}`,
      name,
      mimeType: 'image/png' as const,
      bytes: new Uint8Array([index]),
    }));

    await expect(
      client.sendPrompt('ui-handle', { text: 'Send this' }, attachments)
    ).rejects.toThrow('second upload failed');

    expect(deleteAttachment).toHaveBeenCalledWith({
      handleId: 'server-handle',
      attachmentId: 'uploaded-first',
    });
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it('cleans uploads after an explicit prompt rejection but not an ambiguous disconnect', async () => {
    const attachment = {
      id: 'local-phone',
      name: 'phone.png',
      mimeType: 'image/png' as const,
      bytes: new Uint8Array([1]),
    };
    const explicitDelete = vi.fn(async () => ok(undefined));
    const explicitClient = prepareClient({
      acp: {
        uploadAttachment: vi.fn(async () =>
          ok({ id: 'explicit-upload', name: 'phone.png', mimeType: 'image/png' as const })
        ),
        sendPrompt: vi.fn(async () => failure('prompt rejected')),
        deleteAttachment: explicitDelete,
      },
    });
    privateValue<Map<string, TestOpenResource>>(explicitClient, 'openResources').set('ui-handle', {
      serverHandleId: 'server-handle',
    });

    await expect(
      explicitClient.sendPrompt('ui-handle', { text: 'Send this' }, [attachment])
    ).rejects.toThrow('prompt rejected');
    expect(explicitDelete).toHaveBeenCalledWith({
      handleId: 'server-handle',
      attachmentId: 'explicit-upload',
    });

    const ambiguousDelete = vi.fn(async () => ok(undefined));
    const ambiguousClient = prepareClient({
      acp: {
        uploadAttachment: vi.fn(async () =>
          ok({ id: 'ambiguous-upload', name: 'phone.png', mimeType: 'image/png' as const })
        ),
        sendPrompt: vi.fn(async () => {
          throw new Error('socket disconnected');
        }),
        deleteAttachment: ambiguousDelete,
      },
    });
    privateValue<Map<string, TestOpenResource>>(ambiguousClient, 'openResources').set('ui-handle', {
      serverHandleId: 'server-handle',
    });

    await expect(
      ambiguousClient.sendPrompt('ui-handle', { text: 'Send this' }, [attachment])
    ).rejects.toThrow('socket disconnected');
    expect(ambiguousDelete).not.toHaveBeenCalled();
  });

  it('loads every transcript page beyond the former 100-page limit', async () => {
    const snapshot = vi.fn(async ({ before }: { before?: number }) => {
      const seq = before ?? 102;
      const nextCursor = before === undefined ? 101 : before === 1 ? null : before - 1;
      return ok(
        acpSnapshot({
          turns: [{ id: `turn-${seq}`, seq }] as MobileAcpSnapshot['history']['turns'],
          nextCursor,
        })
      );
    });
    const client = new BrowserMobileClient();

    const result = await snapshotClient(client).loadAcpSnapshot('server-handle', {
      acp: { snapshot },
    });

    expect(snapshot).toHaveBeenCalledTimes(102);
    expect(result.history.nextCursor).toBeNull();
    expect(result.history.turns).toHaveLength(102);
    expect(result.history.turns.map((turn) => turn.seq)).toEqual(
      Array.from({ length: 102 }, (_, index) => index + 1)
    );
  });

  it('rejects a transcript cursor that does not advance', async () => {
    const snapshot = vi
      .fn()
      .mockResolvedValueOnce(ok(acpSnapshot({ turns: [], nextCursor: 5 })))
      .mockResolvedValueOnce(ok(acpSnapshot({ turns: [], nextCursor: 5 })));
    const client = new BrowserMobileClient();

    await expect(
      snapshotClient(client).loadAcpSnapshot('server-handle', { acp: { snapshot } })
    ).rejects.toThrow('non-progressing transcript cursor');
  });
});

describe('browser mobile client resource lifecycle', () => {
  it('closes an ACP server handle when its initial snapshot fails', async () => {
    const closeResource = vi.fn(async () => ok(undefined));
    const wire = {
      openResource: vi.fn(async () =>
        ok({ id: 'server-acp', kind: 'acp', resourceId: 'acp-one', title: 'ACP' })
      ),
      closeResource,
      acp: { snapshot: vi.fn(async () => failure('snapshot failed')) },
    };
    const client = prepareClient(wire);
    indexResource(client, acpResource('acp-one'));

    await expect(client.openResource('acp-one')).rejects.toThrow('snapshot failed');

    expect(closeResource).toHaveBeenCalledWith({ handleId: 'server-acp' });
    expect(privateValue<Map<string, TestOpenResource>>(client, 'openResources').size).toBe(0);
  });

  it('closes a PTY server handle when attaching its output fails', async () => {
    const closeResource = vi.fn(async () => ok(undefined));
    const wire = {
      openResource: vi.fn(async () =>
        ok({ id: 'server-pty', kind: 'terminal', resourceId: 'terminal-one', title: 'Terminal' })
      ),
      closeResource,
      pty: {
        output: {
          handle: vi.fn(() => ({
            attach: vi.fn(async () => {
              throw new Error('attach failed');
            }),
            snapshot: vi.fn(),
          })),
        },
      },
    };
    const client = prepareClient(wire);
    indexResource(client, terminalResource('terminal-one'));

    await expect(client.openResource('terminal-one')).rejects.toThrow('attach failed');

    expect(closeResource).toHaveBeenCalledWith({ handleId: 'server-pty' });
  });

  it('unsubscribes and closes a PTY handle when its initial output snapshot fails', async () => {
    const unsubscribe = vi.fn();
    const closeResource = vi.fn(async () => ok(undefined));
    const wire = {
      openResource: vi.fn(async () =>
        ok({ id: 'server-pty', kind: 'terminal', resourceId: 'terminal-one', title: 'Terminal' })
      ),
      closeResource,
      pty: {
        output: {
          handle: vi.fn(() => ({
            attach: vi.fn(async () => unsubscribe),
            snapshot: vi.fn(async () => {
              throw new Error('snapshot failed');
            }),
          })),
        },
      },
    };
    const client = prepareClient(wire);
    indexResource(client, terminalResource('terminal-one'));

    await expect(client.openResource('terminal-one')).rejects.toThrow('snapshot failed');

    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(closeResource).toHaveBeenCalledWith({ handleId: 'server-pty' });
  });

  it('closes a temporary rename handle even when rename fails', async () => {
    const closeResource = vi.fn(async () => ok(undefined));
    const wire = {
      openResource: vi.fn(async () =>
        ok({ id: 'temporary', kind: 'terminal', resourceId: 'terminal-one', title: 'Terminal' })
      ),
      renameResource: vi.fn(async () => failure('rename failed')),
      closeResource,
    };
    const client = prepareClient(wire);
    indexResource(client, terminalResource('terminal-one'));

    await expect(client.renameResource('terminal-one', 'Renamed')).rejects.toThrow('rename failed');

    expect(closeResource).toHaveBeenCalledWith({ handleId: 'temporary' });
  });

  it('retries only detached resources after an isolated rehydrate failure', async () => {
    let retry: (() => void) | undefined;
    vi.mocked(window.setTimeout).mockImplementation((handler: TimerHandler, delay?: number) => {
      if (delay === 250) retry = handler as () => void;
      return 1 as unknown as ReturnType<typeof window.setTimeout>;
    });
    const unsubscribe = vi.fn();
    const firstAttach = vi
      .fn()
      .mockRejectedValueOnce(new Error('first attach failed'))
      .mockResolvedValue(unsubscribe);
    const closeResource = vi.fn(async () => ok(undefined));
    const wire = {
      initialize: vi.fn(async () => ok(undefined)),
      openResource: vi.fn(async ({ resourceId }: { resourceId: string }) =>
        ok({ id: `server-${resourceId}`, kind: 'terminal', resourceId, title: resourceId })
      ),
      closeResource,
      pty: {
        output: {
          handle: vi.fn(({ handleId }: { handleId: string }) => ({
            attach:
              handleId === 'server-terminal-one' ? firstAttach : vi.fn(async () => unsubscribe),
            snapshot: vi.fn(async () => ({ sequence: 0, data: { text: 'restored' } })),
          })),
        },
      },
    };
    const client = prepareClient(wire);
    const first = indexResource(client, terminalResource('terminal-one'));
    const second = indexResource(client, terminalResource('terminal-two'));
    const opens = privateValue<Map<string, TestOpenResource>>(client, 'openResources');
    opens.set('ui-one', { resourceId: first.id, kind: 'terminal' });
    opens.set('ui-two', { resourceId: second.id, kind: 'terminal' });
    setPrivate(client, 'needsRehydrate', true);

    await rehydrateClient(client).rehydrateOpenResources(0, wire);

    expect(opens.get('ui-one')?.serverHandleId).toBeUndefined();
    expect(opens.get('ui-two')?.serverHandleId).toBe('server-terminal-two');
    expect(closeResource).toHaveBeenCalledWith({ handleId: 'server-terminal-one' });
    expect(client.connectionStatus).toBe('online');
    expect(privateValue(client, 'rehydrateAttempt')).toBeNull();

    retry?.();
    await vi.waitFor(() => expect(opens.get('ui-one')?.serverHandleId).toBe('server-terminal-one'));

    expect(opens.get('ui-two')?.serverHandleId).toBe('server-terminal-two');
    expect(wire.openResource).toHaveBeenCalledTimes(3);
    expect(firstAttach).toHaveBeenCalledTimes(2);
  });

  it('closes a handle reopened after its UI resource was closed', async () => {
    const reopened = deferred<ReturnType<typeof ok>>();
    const closeResource = vi.fn(async () => ok(undefined));
    const wire = {
      initialize: vi.fn(async () => ok(undefined)),
      openResource: vi.fn(() => reopened.promise),
      closeResource,
      pty: { output: { handle: vi.fn() } },
    };
    const client = prepareClient(wire);
    const summary = indexResource(client, terminalResource('terminal-one'));
    const opens = privateValue<Map<string, TestOpenResource>>(client, 'openResources');
    opens.set('ui-one', { resourceId: summary.id, kind: 'terminal' });
    setPrivate(client, 'needsRehydrate', true);

    const rehydrating = rehydrateClient(client).rehydrateOpenResources(0, wire);
    await vi.waitFor(() => expect(wire.openResource).toHaveBeenCalledOnce());
    await client.closeResource('ui-one');
    reopened.resolve(
      ok({
        id: 'reopened-after-close',
        kind: 'terminal',
        resourceId: summary.id,
        title: 'Terminal',
      })
    );
    await rehydrating;

    expect(closeResource).toHaveBeenCalledWith({ handleId: 'reopened-after-close' });
    expect(wire.pty.output.handle).not.toHaveBeenCalled();
    expect(opens.has('ui-one')).toBe(false);
  });

  it('does not let an obsolete reconnect commit a newly opened server handle', async () => {
    const reopened = deferred<ReturnType<typeof ok>>();
    const closeResource = vi.fn(async () => ok(undefined));
    const wire = {
      initialize: vi.fn(async () => ok(undefined)),
      openResource: vi.fn(() => reopened.promise),
      closeResource,
      pty: { output: { handle: vi.fn() } },
    };
    const client = prepareClient(wire);
    const summary = indexResource(client, terminalResource('terminal-one'));
    const opens = privateValue<Map<string, TestOpenResource>>(client, 'openResources');
    const open: TestOpenResource = { resourceId: summary.id, kind: 'terminal' };
    opens.set('ui-one', open);
    setPrivate(client, 'needsRehydrate', true);

    const rehydrating = rehydrateClient(client).rehydrateOpenResources(0, wire);
    await vi.waitFor(() => expect(wire.openResource).toHaveBeenCalledOnce());
    rehydrateClient(client).invalidateConnection();
    reopened.resolve(
      ok({ id: 'obsolete-handle', kind: 'terminal', resourceId: summary.id, title: 'Terminal' })
    );
    await rehydrating;

    expect(closeResource).toHaveBeenCalledWith({ handleId: 'obsolete-handle' });
    expect(open.serverHandleId).toBeUndefined();
    expect(wire.pty.output.handle).not.toHaveBeenCalled();
  });

  it('clears a rejected rehydrate attempt so a later attempt can succeed', async () => {
    const initialize = vi
      .fn()
      .mockResolvedValueOnce(failure('initialize failed'))
      .mockResolvedValueOnce(ok(undefined));
    const wire = { initialize };
    const client = prepareClient(wire);
    setPrivate(client, 'needsRehydrate', true);

    await expect(rehydrateClient(client).rehydrateOpenResources(0, wire)).rejects.toThrow(
      'initialize failed'
    );
    expect(privateValue(client, 'rehydrateAttempt')).toBeNull();

    await rehydrateClient(client).rehydrateOpenResources(0, wire);

    expect(initialize).toHaveBeenCalledTimes(2);
    expect(client.connectionStatus).toBe('online');
  });
});
