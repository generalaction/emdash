import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskProvider } from '@main/core/projects/project-provider';
import { taskManager } from '@main/core/tasks/task-manager';
import { conversations } from '@main/db/schema';
import { ok } from '@shared/result';
import { chatConversationRuntime } from './chat/chat-conversation-runtime';
import { hydrateConversation } from './hydrateConversation';

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  startSession: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  get db() {
    return mocks.db ?? {};
  },
}));

async function seedConversation(
  fixture: Awaited<ReturnType<typeof openFixture>>,
  runtimeMode: 'terminal' | 'chat',
  provider: 'codex' | 'claude' | 'grok' = 'codex'
) {
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

  await fixture.db.insert(conversations).values({
    id: 'conversation-1',
    projectId: 'project-1',
    taskId: 'task-1',
    title: 'Conversation 1',
    provider,
    runtimeMode,
  });
}

async function installTaskProvider(): Promise<void> {
  const taskProvider: TaskProvider = {
    taskId: 'task-1',
    taskBranch: undefined,
    sourceBranch: undefined,
    taskEnvVars: {},
    conversations: {
      startSession: mocks.startSession,
      sendInput: vi.fn(),
      interruptSession: vi.fn(),
      stopSession: vi.fn(),
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
  };

  await internals._lifecycle.provision('task-1', async () =>
    ok({
      taskProvider,
      projectId: 'project-1',
      ctx: {},
      persistData: { workspaceId: 'workspace-1' },
    })
  );
}

describe('hydrateConversation runtime mode', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    await taskManager.teardownTask('task-1', 'terminate');
    vi.clearAllMocks();
    fixture = await openFixture('empty');
    mocks.db = fixture.db;
    mocks.startSession.mockResolvedValue(undefined);
    await installTaskProvider();
  });

  afterEach(async () => {
    chatConversationRuntime.dehydrateConversation('conversation-1');
    fixture.close();
    mocks.db = undefined;
    await taskManager.teardownTask('task-1', 'terminate');
  });

  it('starts a PTY session for terminal conversations', async () => {
    await seedConversation(fixture, 'terminal');

    await hydrateConversation('project-1', 'task-1', 'conversation-1');

    expect(mocks.startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'conversation-1',
        runtimeMode: 'terminal',
        resume: true,
      }),
      undefined,
      true
    );
  });

  it('hydrates chat conversations through the Codex chat runtime', async () => {
    await seedConversation(fixture, 'chat');

    await hydrateConversation('project-1', 'task-1', 'conversation-1');

    expect(mocks.startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'conversation-1',
        runtimeMode: 'chat',
        resume: true,
      }),
      undefined,
      true
    );
    expect(chatConversationRuntime.isActive('conversation-1')).toBe(true);
  });

  it('falls back to a PTY session for terminal-only chat rows', async () => {
    await seedConversation(fixture, 'chat', 'grok');

    await hydrateConversation('project-1', 'task-1', 'conversation-1');

    expect(mocks.startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'conversation-1',
        providerId: 'grok',
        runtimeMode: 'chat',
        resume: true,
      }),
      undefined,
      true
    );
  });
});
