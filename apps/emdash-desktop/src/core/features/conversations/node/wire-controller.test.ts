import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { err, ok } from '@emdash/shared';
import type { LiveSource } from '@emdash/wire';
import { encodeTopic, isDownloadFileOpenResult, type WireFile } from '@emdash/wire/api';
import { describe, expect, it, vi } from 'vitest';
import { conversationsContract } from '../api';
import type { ConversationsRuntimeResolveError as RuntimeResolveError } from '../api/runtime-adapter';
import { createConversationsWireController } from './wire-controller';

vi.mock('@core/features/conversations/node/controller', () => ({
  createConversationOperations: () => ({
    getConversations: vi.fn(),
    createConversation: vi.fn(),
    deleteConversation: vi.fn(),
    hydrateConversation: vi.fn(),
    dehydrateConversation: vi.fn(),
    renameConversation: vi.fn(),
    getConversationsForTask: vi.fn(),
    getConversationsForProject: vi.fn(),
    markConversationSeen: vi.fn(),
  }),
}));
const target = {
  conversationId: 'conversation-1',
  projectId: 'project-1',
  taskId: 'task-1',
  providerId: 'claude',
  sessionId: null,
  modeId: null,
  workspacePath: '/repo',
  host: LOCAL_HOST_REF,
  acpInput: {
    conversationId: 'conversation-1',
    providerId: 'claude',
    cwd: '/repo',
    sessionId: null,
    model: null,
    modeId: null,
  },
} as const;
type TestRuntimeTarget = typeof target;

describe('createConversationsWireController', () => {
  it('awaits ACP session persistence before releasing the broker lease', async () => {
    const order: string[] = [];
    const release = vi.fn(async () => {
      order.push('release');
    });
    const startSession = vi.fn(async () => {
      order.push('runtime');
      return ok({ sessionId: 'session-1' });
    });
    const persistAcpSessionId = vi.fn(async () => {
      order.push('persist');
    });
    const controller = setupController({
      client: { acp: { startSession } },
      release,
      hooks: { persistAcpSessionId },
    });

    await expect(
      controller.call('acp.startSession', { conversationId: target.conversationId })
    ).resolves.toEqual(ok({ sessionId: 'session-1' }));

    expect(startSession).toHaveBeenCalledWith({ input: target.acpInput }, {});
    expect(persistAcpSessionId).toHaveBeenCalledWith(target, 'session-1');
    expect(order).toEqual(['runtime', 'persist', 'release']);
  });

  it('records submitted TUI input only after a successful carriage return', async () => {
    const sendInput = vi.fn(async () => ok(undefined));
    const recordTuiInput = vi.fn(async () => {});
    const controller = setupController({
      client: { tuiAgents: { sendInput } },
      hooks: { recordTuiInput },
    });

    await controller.call('tui.sendInput', {
      conversationId: target.conversationId,
      data: 'hello',
    });
    expect(recordTuiInput).not.toHaveBeenCalled();

    await controller.call('tui.sendInput', {
      conversationId: target.conversationId,
      data: '\r',
    });
    expect(recordTuiInput).toHaveBeenCalledOnce();
    expect(recordTuiInput).toHaveBeenCalledWith(target);
  });

  it('passes uploads through and retains download leases until streaming ends', async () => {
    const release = vi.fn(async () => {});
    const uploadAttachment = vi.fn(async () =>
      ok({ id: 'attachment-1', name: 'image.png', mimeType: 'image/png' as const })
    );
    const downloadAttachment = vi.fn(async () =>
      ok({
        meta: { id: 'attachment-1', name: 'image.png', mimeType: 'image/png' as const },
        chunks: async function* () {
          yield new Uint8Array([1, 2, 3]);
        },
      })
    );
    const controller = setupController({
      client: { acp: { uploadAttachment, downloadAttachment } },
      release,
    });
    const file = fakeWireFile();

    await controller.call(
      'acp.uploadAttachment',
      { conversationId: target.conversationId, originalPath: '/tmp/image.png' },
      { uploadFile: file }
    );
    expect(uploadAttachment).toHaveBeenCalledWith({ originalPath: '/tmp/image.png' }, file, {});

    release.mockClear();
    const result = await controller.call('acp.downloadAttachment', {
      conversationId: target.conversationId,
      id: 'attachment-1',
    });
    expect(isDownloadFileOpenResult(result)).toBe(true);
    if (!isDownloadFileOpenResult(result)) throw new Error('Expected a download result');
    expect(release).not.toHaveBeenCalled();

    const chunks: Uint8Array[] = [];
    for await (const chunk of result.data.source as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([new Uint8Array([1, 2, 3])]);
    expect(release).toHaveBeenCalledOnce();

    release.mockClear();
    const cancelled = await controller.call('acp.downloadAttachment', {
      conversationId: target.conversationId,
      id: 'attachment-1',
    });
    if (!isDownloadFileOpenResult(cancelled)) throw new Error('Expected a download result');
    const iterator = (cancelled.data.source as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
    await iterator.return?.();
    expect(release).toHaveBeenCalledOnce();
  });

  it('holds a broker lease for each attached ACP session state', async () => {
    const release = vi.fn(async () => {});
    const source: LiveSource = {
      snapshot: async () => ({
        generation: 1,
        sequence: 0,
        timestamp: 0,
        data: { lifecycle: 'active' },
      }),
      subscribe: () => () => {},
    };
    const state = vi.fn(() => ({ asLiveSource: () => source }));
    const controller = setupController({
      client: { acp: { session: { state } } },
      release,
    });
    const topic = encodeTopic(conversationsContract.acp.session.states.state.id, {
      conversationId: target.conversationId,
    });

    const lease = controller.acquireLive(topic);
    expect(lease).not.toBeNull();
    await expect(lease?.ready()).resolves.toBe(source);
    expect(release).not.toHaveBeenCalled();

    await lease?.release();
    expect(release).toHaveBeenCalledOnce();
  });

  it('returns RuntimeResolveError from fallible conversation procedures and downloads', async () => {
    const resolveError: RuntimeResolveError = {
      type: 'host-unavailable',
      host: LOCAL_HOST_REF,
      message: 'Runtime unavailable',
    };
    const release = vi.fn(async () => {});
    const controller = setupController({
      client: {},
      release,
      runtimeError: resolveError,
    });

    await expect(
      controller.call('acp.startSession', { conversationId: target.conversationId })
    ).resolves.toEqual(err(resolveError));
    await expect(
      controller.call('acp.downloadAttachment', {
        conversationId: target.conversationId,
        id: 'attachment-1',
      })
    ).resolves.toEqual(err(resolveError));
    expect(release).toHaveBeenCalledTimes(2);
  });
});

function setupController(options: {
  client: object;
  release?: () => Promise<void>;
  runtimeError?: RuntimeResolveError;
  hooks?: Partial<{
    persistAcpSessionId: (target: TestRuntimeTarget, sessionId: string) => Promise<void>;
    persistAcpMode: (target: TestRuntimeTarget, modeId: string) => Promise<void>;
    recordTuiInput: (target: TestRuntimeTarget) => Promise<void>;
  }>;
}) {
  const hooks = {
    persistAcpSessionId: async () => {},
    persistAcpMode: async () => {},
    recordTuiInput: async () => {},
    ...options.hooks,
  };
  return createConversationsWireController({
    db: {} as never,
    logger: { warn: vi.fn() } as never,
    runtimes: {
      session: () => ({
        ready: async () => (options.runtimeError ? err(options.runtimeError) : ok(options.client)),
        release: options.release ?? (async () => {}),
      }),
    } as never,
    workspaceIdentity: {} as never,
    telemetry: { capture: vi.fn() } as never,
    projects: { getProject: vi.fn() },
    taskSessions: { getTask: vi.fn() },
    withCompensation: async ({ action }) => action(),
    resolveTarget: async () => target,
    hooks,
  });
}

function fakeWireFile(): WireFile {
  const data = new Uint8Array([1, 2, 3]);
  return {
    name: 'image.png',
    mimeType: 'image/png',
    size: data.byteLength,
    stream: async function* () {
      yield data;
    },
    bytes: async () => data,
    file: async () => ({
      name: 'image.png',
      mimeType: 'image/png',
      size: data.byteLength,
      stream: async function* () {
        yield data;
      },
    }),
    cancel: () => {},
  };
}
