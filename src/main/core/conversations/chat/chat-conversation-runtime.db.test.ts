import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskProvider } from '@main/core/projects/project-provider';
import { taskManager } from '@main/core/tasks/task-manager';
import { conversationTimelineItems, conversations } from '@main/db/schema';
import { parseConversationConfig } from '@shared/conversation-config';
import type { Conversation } from '@shared/conversations';
import { ok } from '@shared/result';
import { ChatConversationRuntime } from './chat-conversation-runtime';
import type { ChatProviderEventHandler, ChatSessionConfig } from './types';

const adapterMocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  createSession: vi.fn(),
  dispose: vi.fn(),
  onEvent: undefined as undefined | ChatProviderEventHandler,
  sendMessage: vi.fn(),
  tryHandleOutOfBandCommand: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  emit: vi.fn(),
  startSession: vi.fn(),
  stopSession: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  get db() {
    return mocks.db ?? {};
  },
}));

vi.mock('@main/lib/events', () => ({
  events: {
    emit: mocks.emit,
  },
}));

vi.mock('./provider-adapters', () => ({
  getChatProviderAdapter: () => ({
    providerId: 'codex',
    createSession: adapterMocks.createSession,
    resumeSession: adapterMocks.createSession,
    sendMessage: adapterMocks.sendMessage,
    tryHandleOutOfBandCommand: adapterMocks.tryHandleOutOfBandCommand,
    cancel: adapterMocks.cancel,
    dispose: adapterMocks.dispose,
  }),
}));

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conversation-1',
    projectId: 'project-1',
    taskId: 'task-1',
    providerId: 'codex',
    title: 'Conversation 1',
    lastInteractedAt: null,
    isInitialConversation: false,
    runtimeMode: 'chat',
    ...overrides,
  };
}

async function installTaskProvider(): Promise<void> {
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

function seedProjectTaskConversation(fixture: Awaited<ReturnType<typeof openFixture>>): void {
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
  fixture.sqlite
    .prepare(
      `INSERT INTO conversations (
         id,
         project_id,
         task_id,
         provider,
         title,
         runtime_mode,
         created_at,
         updated_at
       )
       VALUES (
         'conversation-1',
         'project-1',
         'task-1',
         'codex',
         'Conversation 1',
         'chat',
         CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP
       )`
    )
    .run();
}

describe('ChatConversationRuntime app-server events', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;
  let runtime: ChatConversationRuntime;

  beforeEach(async () => {
    await taskManager.teardownTask('task-1', 'terminate');
    vi.clearAllMocks();
    fixture = await openFixture('empty');
    mocks.db = fixture.db;
    seedProjectTaskConversation(fixture);
    await installTaskProvider();
    runtime = new ChatConversationRuntime();
    adapterMocks.createSession.mockImplementation(async (config: ChatSessionConfig) => {
      adapterMocks.onEvent = config.onEvent;
      return {
        conversationId: config.conversation.id,
        providerId: 'codex',
        providerSessionId: 'thread-1',
      };
    });
    adapterMocks.tryHandleOutOfBandCommand.mockResolvedValue(false);
    adapterMocks.sendMessage.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await runtime.dehydrateConversation('conversation-1');
    await taskManager.teardownTask('task-1', 'terminate');
    fixture.close();
    mocks.db = undefined;
    adapterMocks.onEvent = undefined;
  });

  it('persists provider timeline events and clears responding state on completion', async () => {
    await runtime.hydrateConversation(makeConversation());
    await adapterMocks.onEvent?.({
      type: 'timeline',
      item: {
        id: 'assistant-1',
        kind: 'assistant_message',
        payload: { text: 'Hello from Codex' },
      },
      upsert: true,
    });
    await adapterMocks.onEvent?.({ type: 'status', status: 'completed' });

    await vi.waitFor(async () => {
      const rows = await fixture.db
        .select()
        .from(conversationTimelineItems)
        .where(eq(conversationTimelineItems.conversationId, 'conversation-1'));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.payload).toBe(JSON.stringify({ text: 'Hello from Codex' }));
    });

    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'next' })
    ).resolves.toMatchObject({ item: expect.objectContaining({ text: 'next' }) });
  });

  it('handles out-of-band slash commands without persisting them as user messages', async () => {
    adapterMocks.tryHandleOutOfBandCommand.mockImplementation((_session, input) =>
      input.text.startsWith('/goal')
    );
    await runtime.hydrateConversation(makeConversation());

    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: '/goal pause' })
    ).resolves.toEqual({});
    await expect(
      runtime.sendMessage('project-1', 'task-1', 'conversation-1', { text: 'hello' })
    ).resolves.toMatchObject({ item: expect.objectContaining({ text: 'hello' }) });

    const rows = await fixture.db
      .select()
      .from(conversationTimelineItems)
      .where(eq(conversationTimelineItems.conversationId, 'conversation-1'));
    const payloads = rows.map((row) => JSON.parse(row.payload) as Record<string, unknown>);

    expect(payloads).toEqual([{ text: 'hello' }]);
    expect(adapterMocks.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('stores provider session id emitted before activation completes', async () => {
    adapterMocks.createSession.mockImplementation(async (config: ChatSessionConfig) => {
      await config.onEvent({ type: 'provider-session', providerSessionId: 'thread-from-event' });
      return {
        conversationId: config.conversation.id,
        providerId: 'codex',
      };
    });

    await runtime.startConversation(makeConversation());

    const [row] = await fixture.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, 'conversation-1'));
    expect(parseConversationConfig(row?.config).providerSessionId).toBe('thread-from-event');
  });
});
