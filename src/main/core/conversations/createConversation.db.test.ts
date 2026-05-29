import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskProvider } from '@main/core/projects/project-provider';
import { appSettingsService } from '@main/core/settings/settings-service';
import { taskManager } from '@main/core/tasks/task-manager';
import { conversationTimelineItems, conversations } from '@main/db/schema';
import { ok } from '@shared/result';
import { chatConversationRuntime } from './chat/chat-conversation-runtime';
import { createConversation } from './createConversation';

const adapterMocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  createSession: vi.fn(),
  dispose: vi.fn(),
  executeSlashCommand: vi.fn(),
  sendMessage: vi.fn(),
  tryHandleOutOfBandCommand: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  startSession: vi.fn(),
  stopSession: vi.fn(),
  captureTelemetry: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  get db() {
    return mocks.db ?? {};
  },
}));

vi.mock('./chat/provider-adapters', () => ({
  getChatProviderAdapter: () => ({
    providerId: 'codex',
    createSession: adapterMocks.createSession,
    resumeSession: adapterMocks.createSession,
    sendMessage: adapterMocks.sendMessage,
    tryHandleOutOfBandCommand: adapterMocks.tryHandleOutOfBandCommand,
    executeSlashCommand: adapterMocks.executeSlashCommand,
    cancel: adapterMocks.cancel,
    dispose: adapterMocks.dispose,
  }),
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: {
    capture: mocks.captureTelemetry,
  },
}));

async function setConversationUiMode(mode: 'terminal' | 'chat') {
  const current = await appSettingsService.get('interface');
  await appSettingsService.update('interface', { ...current, conversationUiMode: mode });
}

async function installTaskProvider(overrides: Partial<TaskProvider> = {}): Promise<void> {
  const taskProvider: TaskProvider = {
    taskId: 'task-1',
    taskBranch: undefined,
    sourceBranch: undefined,
    taskPath: '/repo',
    workspaceKind: 'local',
    taskEnvVars: {},
    conversations: {
      startSession: mocks.startSession,
      sendInput: vi.fn(),
      interruptSession: vi.fn(),
      stopSession: mocks.stopSession,
      destroyAll: vi.fn(),
      detachAll: vi.fn(),
    },
    terminals: {
      spawnTerminal: vi.fn(),
      spawnLifecycleScript: vi.fn(),
      killTerminal: vi.fn(),
      destroyAll: vi.fn(),
      detachAll: vi.fn(),
    },
    ...overrides,
  };
  const internals = taskManager as unknown as {
    _lifecycle: {
      provision: (id: string, run: () => Promise<ReturnType<typeof ok>>) => Promise<unknown>;
    };
    _tasksByProject: Map<string, Set<string>>;
  };

  await internals._lifecycle.provision('task-1', async () =>
    ok({
      taskProvider,
      projectId: 'project-1',
      ctx: {},
      persistData: { workspaceId: 'workspace-1' },
    })
  );
  internals._tasksByProject.set('project-1', new Set(['task-1']));
}

function seedProjectAndTask(fixture: Awaited<ReturnType<typeof openFixture>>): void {
  fixture.sqlite
    .prepare(
      `INSERT INTO projects (id, name, path, created_at, updated_at)
       VALUES ('project-1', 'Project', '/repo', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    )
    .run();
  fixture.sqlite
    .prepare(
      `INSERT INTO tasks (
         id,
         project_id,
         name,
         status,
         created_at,
         updated_at,
         status_changed_at
       )
       VALUES (
         'task-1',
         'project-1',
         'Task',
         'in_progress',
         CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP
       )`
    )
    .run();
}

describe('createConversation runtime mode', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    await taskManager.teardownTask('task-1', 'terminate');
    vi.clearAllMocks();
    fixture = await openFixture('empty');
    mocks.db = fixture.db;
    mocks.startSession.mockResolvedValue(undefined);
    mocks.stopSession.mockResolvedValue(undefined);
    adapterMocks.createSession.mockResolvedValue({
      conversationId: 'conversation-1',
      providerId: 'codex',
      providerSessionId: 'codex-thread-1',
    });
    adapterMocks.sendMessage.mockResolvedValue(undefined);
    adapterMocks.tryHandleOutOfBandCommand.mockResolvedValue(false);
    adapterMocks.executeSlashCommand.mockResolvedValue(undefined);
    adapterMocks.dispose.mockResolvedValue(undefined);
    await installTaskProvider();
    seedProjectAndTask(fixture);
    await appSettingsService.reset('interface');
  });

  afterEach(async () => {
    await chatConversationRuntime.dehydrateConversation('conversation-1');
    fixture.close();
    mocks.db = undefined;
    await taskManager.teardownTask('task-1', 'terminate');
  });

  it('persists terminal runtime and starts the PTY session when terminal mode is selected', async () => {
    await setConversationUiMode('terminal');

    const conversation = await createConversation({
      id: 'conversation-1',
      projectId: 'project-1',
      taskId: 'task-1',
      title: 'Terminal conversation',
      provider: 'codex',
      initialPrompt: 'hello',
    });

    const [row] = await fixture.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, 'conversation-1'));

    expect(row?.runtimeMode).toBe('terminal');
    expect(conversation.runtimeMode).toBe('terminal');
    expect(mocks.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conversation-1', runtimeMode: 'terminal' }),
      undefined,
      false,
      'hello'
    );
    expect(adapterMocks.createSession).not.toHaveBeenCalled();
  });

  it('persists chat runtime and does not start a PTY session', async () => {
    await setConversationUiMode('chat');

    const conversation = await createConversation({
      id: 'conversation-1',
      projectId: 'project-1',
      taskId: 'task-1',
      title: 'Chat conversation',
      provider: 'codex',
      initialPrompt: 'hello',
    });

    const [row] = await fixture.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, 'conversation-1'));
    const rows = await fixture.db
      .select()
      .from(conversationTimelineItems)
      .where(eq(conversationTimelineItems.conversationId, 'conversation-1'));

    expect(row?.runtimeMode).toBe('chat');
    expect(conversation.runtimeMode).toBe('chat');
    expect(mocks.startSession).not.toHaveBeenCalled();
    expect(adapterMocks.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/repo' })
    );
    expect(adapterMocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ providerSessionId: 'codex-thread-1' }),
      expect.objectContaining({ text: 'hello' })
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'user_message',
      sequence: 1,
      payload: JSON.stringify({ text: 'hello' }),
    });
    expect(chatConversationRuntime.isActive('conversation-1')).toBe(true);
  });

  it('records structured chat adapter events in the DB timeline', async () => {
    await setConversationUiMode('chat');
    adapterMocks.sendMessage.mockImplementationOnce(async () => {
      const config = adapterMocks.createSession.mock.calls[0][0];
      await config.onEvent({
        type: 'timeline',
        item: {
          id: 'assistant-1',
          kind: 'assistant_message',
          payload: { text: 'hello from app-server' },
        },
        upsert: true,
      });
      await config.onEvent({ type: 'status', status: 'completed' });
    });

    await createConversation({
      id: 'conversation-1',
      projectId: 'project-1',
      taskId: 'task-1',
      title: 'Chat conversation',
      provider: 'codex',
      initialPrompt: 'hello',
    });

    const rows = await fixture.db
      .select()
      .from(conversationTimelineItems)
      .where(eq(conversationTimelineItems.conversationId, 'conversation-1'));

    expect(rows.map((row) => row.kind)).toEqual(['user_message', 'assistant_message']);
    expect(rows[1]).toMatchObject({
      id: 'conversation-1:assistant-1',
      kind: 'assistant_message',
      payload: JSON.stringify({ text: 'hello from app-server' }),
    });
  });

  it('executes out-of-band slash commands without persisting them as user messages', async () => {
    await setConversationUiMode('chat');
    adapterMocks.tryHandleOutOfBandCommand.mockResolvedValueOnce(true);

    await createConversation({
      id: 'conversation-1',
      projectId: 'project-1',
      taskId: 'task-1',
      title: 'Chat conversation',
      provider: 'codex',
      initialPrompt: '/compact',
    });

    const rows = await fixture.db
      .select()
      .from(conversationTimelineItems)
      .where(eq(conversationTimelineItems.conversationId, 'conversation-1'));

    expect(adapterMocks.tryHandleOutOfBandCommand).toHaveBeenCalledWith(
      expect.objectContaining({ providerSessionId: 'codex-thread-1' }),
      expect.objectContaining({ text: '/compact' })
    );
    expect(adapterMocks.sendMessage).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
  });

  it('guards command RPC execution with the same runtime state as message sends', async () => {
    await setConversationUiMode('chat');
    adapterMocks.executeSlashCommand.mockImplementationOnce(async () => {
      const config = adapterMocks.createSession.mock.calls[0][0];
      await config.onEvent({ type: 'status', status: 'completed' });
    });

    await createConversation({
      id: 'conversation-1',
      projectId: 'project-1',
      taskId: 'task-1',
      title: 'Chat conversation',
      provider: 'codex',
    });

    await chatConversationRuntime.executeSlashCommand('project-1', 'task-1', 'conversation-1', {
      name: 'compact',
    });

    expect(adapterMocks.executeSlashCommand).toHaveBeenCalledWith(
      expect.objectContaining({ providerSessionId: 'codex-thread-1' }),
      { name: 'compact' }
    );

    let resolveCommand!: () => void;
    adapterMocks.executeSlashCommand.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveCommand = resolve;
        })
    );
    const commandPromise = chatConversationRuntime.executeSlashCommand(
      'project-1',
      'task-1',
      'conversation-1',
      {
        name: 'compact',
      }
    );
    await expect(
      chatConversationRuntime.executeSlashCommand('project-1', 'task-1', 'conversation-1', {
        name: 'compact',
      })
    ).rejects.toThrow('Agent is still responding');
    resolveCommand();
    await commandPromise;
  });

  it('falls back to terminal runtime for providers without a structured chat adapter', async () => {
    await setConversationUiMode('chat');

    const conversation = await createConversation({
      id: 'conversation-1',
      projectId: 'project-1',
      taskId: 'task-1',
      title: 'Terminal fallback',
      provider: 'claude',
    });

    expect(conversation.runtimeMode).toBe('terminal');
    expect(mocks.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ runtimeMode: 'terminal' }),
      undefined,
      false,
      undefined
    );
    expect(adapterMocks.createSession).not.toHaveBeenCalled();
  });

  it('falls back to terminal runtime for SSH workspaces even when chat mode is selected', async () => {
    await setConversationUiMode('chat');
    await taskManager.teardownTask('task-1', 'terminate');
    await installTaskProvider({ workspaceKind: 'ssh' });

    const conversation = await createConversation({
      id: 'conversation-1',
      projectId: 'project-1',
      taskId: 'task-1',
      title: 'SSH fallback',
      provider: 'codex',
      initialPrompt: 'hello',
    });

    expect(conversation.runtimeMode).toBe('terminal');
    expect(mocks.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ runtimeMode: 'terminal' }),
      undefined,
      false,
      'hello'
    );
    expect(adapterMocks.createSession).not.toHaveBeenCalled();
  });

  it('rejects creation when the task is not mounted', async () => {
    await taskManager.teardownTask('task-1', 'terminate');

    await expect(
      createConversation({
        id: 'conversation-1',
        projectId: 'project-1',
        taskId: 'task-1',
        title: 'Missing task',
        provider: 'codex',
      })
    ).rejects.toThrow('Task not found');
  });

  it('rolls back the row when Codex app-server session creation fails', async () => {
    await setConversationUiMode('chat');
    adapterMocks.createSession.mockRejectedValueOnce(new Error('app-server failed'));

    await expect(
      createConversation({
        id: 'conversation-1',
        projectId: 'project-1',
        taskId: 'task-1',
        title: 'Chat conversation',
        provider: 'codex',
      })
    ).rejects.toThrow('app-server failed');

    const rows = await fixture.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, 'conversation-1'));
    expect(rows).toEqual([]);
    expect(mocks.startSession).not.toHaveBeenCalled();
    expect(chatConversationRuntime.isActive('conversation-1')).toBe(false);
  });
});
