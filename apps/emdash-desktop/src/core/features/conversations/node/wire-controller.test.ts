import {
  formatHostRef,
  hostRef,
  LOCAL_HOST_REF,
  type HostRef,
} from '@emdash/core/primitives/host/api';
import type { ProviderOptionValues } from '@emdash/core/runtimes/acp/api/client';
import { err, ok } from '@emdash/shared';
import { deferred } from '@emdash/shared/testing';
import type { LiveSource } from '@emdash/wire/rpc';
import { encodeTopic, isDownloadFileOpenResult, WireError, type WireFile } from '@emdash/wire/rpc';
import { describe, expect, it, vi } from 'vitest';
import { conversationsContract } from '../api';
import type { ConversationsRuntimeResolveError as RuntimeResolveError } from '../api/runtime-adapter';
import { getProviderSettingsService } from './provider-settings-service';
import { createConversationsWireController } from './wire-controller';

vi.mock('./provider-settings-service', async () => {
  const { cell, expose } = await import('@emdash/wire/state');
  const { conversationsContract } = await import('../api/contract');
  const { emptyProviderSettings } = await import('../api/provider-settings');
  const settings = {
    model: expose(conversationsContract.providerSettings.model, {
      value: () => cell(emptyProviderSettings),
    }),
    patch: vi.fn(async () => emptyProviderSettings),
  };
  return { getProviderSettingsService: () => settings };
});

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
  conversationType: 'acp',
  providerId: 'claude',
  sessionId: null,
  workspacePath: '/repo',
  host: LOCAL_HOST_REF,
  acpInput: {
    conversationId: 'conversation-1',
    providerId: 'claude',
    cwd: '/repo',
    sessionId: null,
  },
} as const;
type TestRuntimeTarget = typeof target;

describe('createConversationsWireController', () => {
  it.each([false, true])(
    'shares native preferences only after provider acceptance (%s)',
    async (success) => {
      const settings = getProviderSettingsService({} as never);
      vi.mocked(settings.patch).mockClear();
      const setOption = vi.fn(async () =>
        success
          ? ok({ reapplyFailures: [] })
          : err({
              type: 'set_config_failed' as const,
              cause: { name: 'Error', message: 'rejected' },
            })
      );
      const patchConfig = vi.fn(async () => ok({ skippedKeys: [] }));
      const host = hostRef('remote', 'server-options');
      const controller = setupController({
        host,
        client: { acp: { setOption }, conversations: { patchConfig } },
      });
      const input = {
        conversationId: target.conversationId,
        configId: 'native-fast',
        value: false,
      };
      const result = await controller.call('acp.setOption', input);
      expect(result).toMatchObject({ success });
      if (success) {
        expect(patchConfig).toHaveBeenCalledWith({
          conversationId: input.conversationId,
          patch: {},
          mapPatch: {
            field: 'options',
            entries: { 'native-fast': false },
            expected: { 'native-fast': undefined },
          },
        });
        expect(settings.patch).toHaveBeenCalledWith(
          expect.objectContaining({ host: formatHostRef(host), providerId: target.providerId }),
          { transport: 'acp', options: { 'native-fast': false } }
        );
      } else {
        expect(patchConfig).toHaveBeenCalledTimes(2);
        expect(patchConfig).toHaveBeenLastCalledWith({
          conversationId: input.conversationId,
          patch: {},
          mapPatch: {
            field: 'options',
            entries: { 'native-fast': null },
            expected: { 'native-fast': false },
          },
        });
        expect(settings.patch).not.toHaveBeenCalled();
      }
    }
  );

  it('persists the accepted choice and forwards secondary restoration failures', async () => {
    const settings = getProviderSettingsService({} as never);
    vi.mocked(settings.patch).mockClear();
    const accepted = ok({
      reapplyFailures: [
        {
          configId: 'reasoning_effort',
          error: {
            type: 'set_config_failed' as const,
            cause: { name: 'Error', message: 'effort temporarily unavailable' },
          },
        },
      ],
    });
    const setOption = vi.fn(async () => accepted);
    const patchConfig = vi.fn(async () => ok({ skippedKeys: [] }));
    const controller = setupController({
      client: { acp: { setOption }, conversations: { patchConfig } },
    });
    const input = { conversationId: target.conversationId, configId: 'model', value: 'b' };

    await expect(controller.call('acp.setOption', input)).resolves.toEqual(accepted);

    expect(patchConfig).toHaveBeenCalledWith({
      conversationId: input.conversationId,
      patch: {},
      mapPatch: { field: 'options', entries: { model: 'b' }, expected: { model: undefined } },
    });
    expect(settings.patch).toHaveBeenCalledWith(
      { host: formatHostRef(target.host), providerId: target.providerId },
      { transport: 'acp', options: { model: 'b' } }
    );
  });

  it.each(['resume', 'fresh'] as const)(
    'starts in %s mode with the trusted descriptor',
    async (mode) => {
      const startSession = vi.fn(async () => ok({ sessionId: 'session-1' }));
      const controller = setupController({ client: { acp: { startSession } } });
      expect(
        await controller.call('acp.startSession', { conversationId: target.conversationId, mode })
      ).toEqual(ok({ sessionId: 'session-1' }));
      expect(startSession).toHaveBeenCalledWith({ ...target.acpInput, mode }, { timeoutMs: 0 });
    }
  );
  it.each([
    {
      sessionId: null,
      config: { initialQueue: [{ text: 'first' }] },
      expectedQueue: [{ text: 'first' }],
    },
    {
      sessionId: 'saved',
      config: { initialQueue: [{ text: 'first' }] },
      expectedQueue: [{ text: 'first' }],
    },
    {
      sessionId: 'saved',
      config: { initialPrompt: 'legacy' },
      expectedQueue: undefined,
    },
    {
      sessionId: 'saved',
      config: { initialQueue: [], initialPrompt: 'legacy' },
      expectedQueue: undefined,
    },
    { sessionId: 'saved', config: { initialPrompt: '  ' }, expectedQueue: undefined },
    { sessionId: 'saved', config: {}, expectedQueue: undefined },
  ])(
    'supplies trusted initial prompts and environment for $sessionId with $config',
    async ({ sessionId, config, expectedQueue }) => {
      const attach = vi.fn(async (_input: unknown) => ok({ sessionId: null }));
      const getProviderEnv = vi.fn(async () => ({
        CLAUDE_CONFIG_DIR: '/provider/config',
        PROVIDER_ONLY: 'provider',
      }));
      const resolveLaunchContext = vi.fn(async () =>
        ok({
          workspace: {
            workspaceId: 'workspace-1',
            projectId: target.projectId,
            host: LOCAL_HOST_REF,
            path: target.workspacePath,
          },
          tmux: false,
          env: {
            CLAUDE_CONFIG_DIR: '/project/config',
            PROJECT_ONLY: 'project',
          },
        })
      );
      const db = {
        select: vi.fn(() => ({
          from: () => ({
            leftJoin: () => ({
              where: () => ({
                limit: async () => [
                  {
                    projectId: target.projectId,
                    taskId: target.taskId,
                    providerId: target.providerId,
                    sessionId,
                    config: { version: '1', type: 'acp', ...config },
                    type: 'acp',
                    workspaceId: 'workspace-1',
                  },
                ],
              }),
            }),
          }),
        })),
      };
      const controller = createConversationsWireController({
        terminalFileSources: { prepare: vi.fn() },
        db: db as never,
        logger: { warn: vi.fn() } as never,
        runtimes: { client: async () => ok({ acp: { attach } }) } as never,
        workspaceIdentity: {
          resolve: vi.fn(async () => ({ host: LOCAL_HOST_REF, path: target.workspacePath })),
        },
        getProviderEnv,
        sessionLaunchContexts: { resolve: resolveLaunchContext },
        telemetry: { capture: vi.fn() } as never,
        projects: { requireAttached: vi.fn(() => ok({} as never)) },
        taskSessions: { getTask: vi.fn() },
        withCompensation: async ({ action }) => action(),
        hostIsReachable: () => true,
      });

      await expect(
        controller.call('acp.attach', { conversationId: target.conversationId })
      ).resolves.toEqual(ok({ sessionId: null }));

      expect(attach).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId,
          env: {
            CLAUDE_CONFIG_DIR: '/project/config',
            PROVIDER_ONLY: 'provider',
            PROJECT_ONLY: 'project',
          },
        }),
        {}
      );
      if (expectedQueue)
        expect(attach.mock.calls[0]?.[0]).toHaveProperty('initialQueue', expectedQueue);
      else expect(attach.mock.calls[0]?.[0]).not.toHaveProperty('initialQueue');
      expect(resolveLaunchContext).toHaveBeenCalledWith({
        projectId: target.projectId,
        taskId: target.taskId,
        workspaceId: 'workspace-1',
      });
    }
  );

  it('attaches with the trusted descriptor and reads history without starting a session', async () => {
    const attach = vi.fn(async () => ok({ sessionId: null }));
    const page = {
      kind: 'available' as const,
      turns: [],
      nextCursor: null,
      position: { generation: 'test', historyRevision: 0, lastCommittedTurnSeq: null },
      coverage: { fromSeq: null, beforeSeq: null },
    };
    const loadHistory = vi.fn(async () => ok(page));
    const controller = setupController({ client: { acp: { attach, loadHistory } } });

    await expect(
      controller.call('acp.attach', { conversationId: target.conversationId })
    ).resolves.toEqual(ok({ sessionId: null }));
    await expect(
      controller.call('acp.loadHistory', { conversationId: target.conversationId, limit: 100 })
    ).resolves.toEqual(ok(page));

    expect(attach).toHaveBeenCalledWith(target.acpInput, {});
    expect(loadHistory).toHaveBeenCalledWith(
      { conversationId: target.conversationId, limit: 100 },
      {}
    );
  });

  it('waits for host config persistence before contacting the provider', async () => {
    const saved = deferred<ReturnType<typeof ok<{ skippedKeys: string[] }>>>();
    const patchConfig = vi.fn(() => saved.promise);
    const setOption = vi.fn(async () => ok({ reapplyFailures: [] }));
    const controller = setupController({
      client: { acp: { setOption }, conversations: { patchConfig } },
    });
    const pending = controller.call('acp.setOption', {
      conversationId: target.conversationId,
      configId: 'native-effort',
      value: 'high',
    });
    try {
      await vi.waitFor(() => expect(patchConfig).toHaveBeenCalledOnce());
      expect(setOption).not.toHaveBeenCalled();
    } finally {
      saved.resolve(ok({ skippedKeys: [] }));
      await pending;
    }
    expect(setOption).toHaveBeenCalledOnce();
  });

  it('does not contact the provider when saving host config fails', async () => {
    const setOption = vi.fn(async () => ok({ reapplyFailures: [] }));
    const patchConfig = vi.fn(async () => ok({ skippedKeys: [] }));
    const controller = setupController({
      client: { acp: { setOption }, conversations: { patchConfig } },
    });
    const input = {
      conversationId: target.conversationId,
      configId: 'native-effort',
      value: 'high',
    };

    await expect(controller.call('acp.setOption', input)).resolves.toEqual(
      ok({ reapplyFailures: [] })
    );
    expect(patchConfig).toHaveBeenCalledWith({
      conversationId: target.conversationId,
      patch: {},
      mapPatch: {
        field: 'options',
        entries: { 'native-effort': 'high' },
        expected: { 'native-effort': undefined },
      },
    });

    patchConfig.mockResolvedValueOnce(err({ message: 'host rejected write' }) as never);
    await expect(controller.call('acp.setOption', input)).resolves.toMatchObject({
      success: false,
      error: { type: 'set_config_failed', cause: { message: 'host rejected write' } },
    });
    expect(setOption).toHaveBeenCalledOnce();

    patchConfig.mockRejectedValueOnce(new Error('write failed'));
    await expect(controller.call('acp.setOption', input)).rejects.toThrow('write failed');
    expect(setOption).toHaveBeenCalledOnce();
  });

  it.each([
    { previous: 'medium', throws: false },
    { previous: false, throws: true },
    { previous: undefined, throws: false },
  ])(
    'restores the saved value $previous after provider failure (throws=$throws)',
    async ({ previous, throws }) => {
      const settings = getProviderSettingsService({} as never);
      vi.mocked(settings.patch).mockClear();
      const failure = err({
        type: 'set_config_failed' as const,
        cause: { name: 'Error', message: 'provider rejected setting' },
      });
      const setOption = vi.fn(async () => {
        if (throws) throw new Error('provider disconnected');
        return failure;
      });
      const patchConfig = vi.fn(async () => ok({ skippedKeys: [] }));
      const controller = setupController({
        savedOptions: { model: 'astra', ...(previous === undefined ? {} : { setting: previous }) },
        client: { acp: { setOption }, conversations: { patchConfig } },
      });
      const pending = controller.call('acp.setOption', {
        conversationId: target.conversationId,
        configId: 'setting',
        value: 'high',
      });
      if (throws) await expect(pending).rejects.toThrow('provider disconnected');
      else await expect(pending).resolves.toEqual(failure);
      expect(patchConfig).toHaveBeenCalledTimes(2);
      expect(patchConfig).toHaveBeenLastCalledWith({
        conversationId: target.conversationId,
        patch: {},
        mapPatch: {
          field: 'options',
          entries: { setting: previous ?? null },
          expected: { setting: 'high' },
        },
      });
      expect(settings.patch).not.toHaveBeenCalled();
    }
  );

  it('surfaces failed compensation after provider rejection', async () => {
    const setOption = vi.fn(async () =>
      err({
        type: 'set_config_failed' as const,
        cause: { name: 'Error', message: 'rejected' },
      })
    );
    const patchConfig = vi
      .fn()
      .mockResolvedValueOnce(ok({ skippedKeys: [] }))
      .mockResolvedValueOnce(err({ message: 'host rejected rollback' }));
    const controller = setupController({
      client: { acp: { setOption }, conversations: { patchConfig } },
    });
    await expect(
      controller.call('acp.setOption', {
        conversationId: target.conversationId,
        configId: 'model',
        value: 'astra',
      })
    ).rejects.toThrow('Could not restore previous conversation setting: host rejected rollback');
    expect(patchConfig).toHaveBeenCalledTimes(2);
  });

  it.each(['B', 'C'])(
    'does not apply or roll back a choice when another client already selected %s',
    async (model) => {
      const settings = getProviderSettingsService({} as never);
      vi.mocked(settings.patch).mockClear();
      const setOption = vi.fn(async () => ok({ reapplyFailures: [] }));
      const patchConfig = vi.fn(async () =>
        ok({
          record: { config: { options: { model } } },
          skippedKeys: ['model'],
        })
      );
      const controller = setupController({
        savedOptions: { model: 'A' },
        client: { acp: { setOption }, conversations: { patchConfig } },
      });
      await expect(
        controller.call('acp.setOption', {
          conversationId: target.conversationId,
          configId: 'model',
          value: 'C',
        })
      ).resolves.toMatchObject({
        success: false,
        error: { type: 'set_config_failed', cause: { name: 'ConfigurationConflict' } },
      });
      expect(patchConfig).toHaveBeenCalledExactlyOnceWith({
        conversationId: target.conversationId,
        patch: {},
        mapPatch: { field: 'options', entries: { model: 'C' }, expected: { model: 'A' } },
      });
      expect(setOption).not.toHaveBeenCalled();
      expect(settings.patch).not.toHaveBeenCalled();
    }
  );

  it('returns success with a warning when sharing an accepted preference fails', async () => {
    const settings = getProviderSettingsService({} as never);
    vi.mocked(settings.patch).mockRejectedValueOnce(new Error('preference save failed'));
    const setOption = vi.fn(async () => ok({ reapplyFailures: [] }));
    const patchConfig = vi.fn(async () => ok({ skippedKeys: [] }));
    const controller = setupController({
      client: { acp: { setOption }, conversations: { patchConfig } },
    });
    const result = await controller.call('acp.setOption', {
      conversationId: target.conversationId,
      configId: 'model',
      value: 'astra',
    });
    expect(conversationsContract.acp.setOption.output.parse(result)).toEqual(
      ok({
        reapplyFailures: [],
        preferenceSaveError: 'preference save failed',
      })
    );
    expect(patchConfig).toHaveBeenCalledOnce();
  });

  it('allows activation to finish before acknowledging prompt acceptance', async () => {
    const sendPrompt = vi.fn(async () => ok({ queued: false }));
    const controller = setupController({
      client: { acp: { sendPrompt } },
    });
    const input = {
      conversationId: target.conversationId,
      promptId: crypto.randomUUID(),
      prompt: { text: 'hello' },
    };

    await expect(controller.call('acp.sendPrompt', input)).resolves.toEqual(ok({ queued: false }));

    expect(sendPrompt).toHaveBeenCalledWith(input, { timeoutMs: 0 });
  });

  it.each(['UNKNOWN_PROCEDURE', 'DISCONNECTED', 'TIMEOUT'] as const)(
    'does not resend a prompt after %s',
    async (code) => {
      const sendPrompt = vi.fn().mockRejectedValue(new WireError(code, 'submission failed'));
      const controller = setupController({ client: { acp: { sendPrompt } } });
      const input = {
        conversationId: target.conversationId,
        promptId: crypto.randomUUID(),
        prompt: { text: 'hello' },
      };
      await expect(controller.call('acp.sendPrompt', input)).rejects.toMatchObject({ code });
      expect(sendPrompt).toHaveBeenCalledOnce();
    }
  );

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

  it.each(['acp', 'pty'] as const)(
    'routes %s attachments to the conversation host',
    async (conversationType) => {
      const remoteHost = hostRef('remote', 'ssh-attachments');
      const resolvedHosts: HostRef[] = [];
      const uploadAttachment = vi.fn(async (_input: { conversationId: string }, _file: WireFile) =>
        ok({
          id: 'attachment-1',
          name: 'image.png',
          mimeType: 'image/png' as const,
          pathStyle: 'posix' as const,
          targetPath: '/host/attachments/image.png',
        })
      );
      const downloadAttachment = vi.fn(async () =>
        ok({
          meta: {
            id: 'attachment-1',
            name: 'image.png',
            mimeType: 'image/png' as const,
            pathStyle: 'posix' as const,
            targetPath: '/host/attachments/image.png',
          },
          chunks: async function* () {
            yield new Uint8Array([1, 2, 3]);
          },
        })
      );
      const controller = setupController({
        conversationType,
        host: remoteHost,
        resolvedHosts,
        client: {
          conversations: {
            attachments: { upload: uploadAttachment, download: downloadAttachment },
          },
        },
      });
      const file = fakeWireFile();

      await controller.call(
        'attachments.upload',
        { conversationId: target.conversationId },
        { uploadFile: file }
      );
      expect(uploadAttachment).toHaveBeenCalledWith(
        { conversationId: target.conversationId },
        expect.objectContaining({ name: file.name, mimeType: file.mimeType, size: file.size }),
        {}
      );
      expect(resolvedHosts).toEqual([remoteHost]);
      expect(await uploadAttachment.mock.calls[0][1].bytes()).toEqual(await file.bytes());

      const result = await controller.call('attachments.download', {
        conversationId: target.conversationId,
        attachmentId: 'attachment-1',
      });
      expect(downloadAttachment).toHaveBeenCalledWith(
        { conversationId: target.conversationId, attachmentId: 'attachment-1' },
        {}
      );
      expect(isDownloadFileOpenResult(result)).toBe(true);
      if (!isDownloadFileOpenResult(result)) throw new Error('Expected a download result');
      const chunks: Uint8Array[] = [];
      for await (const chunk of result.data.source as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual([new Uint8Array([1, 2, 3])]);

      const cancelled = await controller.call('attachments.download', {
        conversationId: target.conversationId,
        attachmentId: 'attachment-1',
      });
      if (!isDownloadFileOpenResult(cancelled)) throw new Error('Expected a download result');
      const iterator = (cancelled.data.source as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
      await iterator.return?.();
    }
  );

  it('resolves the client for each attached ACP session state', async () => {
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
    });
    const topic = encodeTopic(conversationsContract.acp.session.states.state.id, {
      conversationId: target.conversationId,
    });

    const lease = controller.acquireLive(topic);
    expect(lease).not.toBeNull();
    await expect(lease?.ready()).resolves.toBe(source);

    await lease?.release();
  });

  it('forwards aggregate ACP sessions through the host encoded in the desktop key', async () => {
    const remoteHost = hostRef('remote', 'ssh-1');
    const resolvedHosts: HostRef[] = [];
    const source: LiveSource = {
      snapshot: async () => ({ generation: 1, sequence: 0, timestamp: 0, data: {} }),
      subscribe: () => () => {},
    };
    const state = vi.fn(() => ({ asLiveSource: () => source }));
    const controller = setupController({
      client: { acp: { sessions: { state } } },
      resolvedHosts,
    });
    const topic = encodeTopic(conversationsContract.acp.sessions.states.list.id, {
      host: formatHostRef(remoteHost),
      projectId: target.projectId,
    });

    const lease = controller.acquireLive(topic);
    await expect(lease?.ready()).resolves.toBe(source);

    expect(resolvedHosts).toEqual([remoteHost]);
    expect(state).toHaveBeenCalledWith(undefined, 'list');
    await lease?.release();
  });

  it('forwards aggregate TUI sessions through the host encoded in the desktop key', async () => {
    const remoteHost = hostRef('remote', 'ssh-2');
    const resolvedHosts: HostRef[] = [];
    const source: LiveSource = {
      snapshot: async () => ({ generation: 1, sequence: 0, timestamp: 0, data: {} }),
      subscribe: () => () => {},
    };
    const state = vi.fn(() => ({ asLiveSource: () => source }));
    const controller = setupController({
      client: { tuiAgents: { sessions: { state } } },
      resolvedHosts,
    });
    const topic = encodeTopic(conversationsContract.tui.sessions.states.list.id, {
      host: formatHostRef(remoteHost),
      projectId: target.projectId,
    });

    const lease = controller.acquireLive(topic);
    await expect(lease?.ready()).resolves.toBe(source);

    expect(resolvedHosts).toEqual([remoteHost]);
    expect(state).toHaveBeenCalledWith(undefined, 'list');
    await lease?.release();
  });

  it('returns RuntimeResolveError from fallible conversation procedures and downloads', async () => {
    const resolveError: RuntimeResolveError = {
      type: 'host-unavailable',
      host: LOCAL_HOST_REF,
      reason: 'runtime-unavailable',
      message: 'Runtime unavailable',
    };
    const controller = setupController({
      client: {},
      runtimeError: resolveError,
    });

    await expect(
      controller.call('acp.loadHistory', {
        conversationId: target.conversationId,
        limit: 50,
      })
    ).resolves.toEqual(err(resolveError));
    await expect(
      controller.call('attachments.download', {
        conversationId: target.conversationId,
        attachmentId: 'attachment-1',
      })
    ).resolves.toEqual(err(resolveError));
  });

  it('requires effective project attachment before live conversation calls', async () => {
    const resolvedHosts: HostRef[] = [];
    const attachmentError = {
      type: 'project-missing' as const,
      projectId: target.projectId,
    };
    const controller = setupController({
      client: {},
      attachmentError,
      resolvedHosts,
    });

    await expect(
      controller.call('acp.sendPrompt', {
        conversationId: target.conversationId,
        promptId: '00000000-0000-4000-8000-000000000001',
        prompt: { text: 'hello' },
      })
    ).resolves.toEqual(err(attachmentError));
    await expect(
      controller.call('dehydrateConversation', {
        projectId: target.projectId,
        taskId: target.taskId,
        conversationId: target.conversationId,
      })
    ).resolves.toEqual(err(attachmentError));
    const topic = encodeTopic(conversationsContract.acp.sessions.states.list.id, {
      host: formatHostRef(LOCAL_HOST_REF),
      projectId: target.projectId,
    });
    const lease = controller.acquireLive(topic);
    await expect(lease?.ready()).rejects.toThrow('project-missing');
    await lease?.release();
    expect(resolvedHosts).toEqual([]);
  });
});

function setupController(options: {
  client: Record<string, unknown> & { conversations?: object };
  savedOptions?: ProviderOptionValues;
  host?: HostRef;
  conversationType?: 'acp' | 'pty';
  runtimeError?: RuntimeResolveError;
  attachmentError?: { type: 'project-missing'; projectId: string };
  resolvedHosts?: HostRef[];
  hooks?: Partial<{
    recordTuiInput: (target: TestRuntimeTarget) => Promise<void>;
  }>;
}) {
  const hooks = {
    recordTuiInput: async () => {},
    ...options.hooks,
  };
  return createConversationsWireController({
    terminalFileSources: { prepare: vi.fn() },
    db: {} as never,
    logger: { warn: vi.fn() } as never,
    runtimes: {
      client: async (host: HostRef) => {
        options.resolvedHosts?.push(host);
        return options.runtimeError
          ? err(options.runtimeError)
          : ok({
              ...options.client,
              conversations: {
                records: {
                  state: () => ({
                    snapshot: async () => ({
                      data: {
                        [target.conversationId]: {
                          config: { options: options.savedOptions ?? {} },
                        },
                      },
                    }),
                  }),
                },
                ...options.client.conversations,
              },
            });
      },
    } as never,
    workspaceIdentity: {} as never,
    sessionLaunchContexts: {} as never,
    telemetry: { capture: vi.fn() } as never,
    projects: {
      requireAttached: vi.fn(() =>
        options.attachmentError ? err(options.attachmentError) : ok({} as never)
      ),
    },
    taskSessions: { getTask: vi.fn() },
    withCompensation: async ({ action }) => action(),
    hostIsReachable: () => true,
    resolveTarget: async () => ({
      ...target,
      host: options.host ?? target.host,
      conversationType: options.conversationType ?? target.conversationType,
    }),
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
