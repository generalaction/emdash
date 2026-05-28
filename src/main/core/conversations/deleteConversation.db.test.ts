import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskProvider } from '@main/core/projects/project-provider';
import { taskManager } from '@main/core/tasks/task-manager';
import { conversations } from '@main/db/schema';
import { ok } from '@shared/result';
import { chatConversationRuntime } from './chat/chat-conversation-runtime';
import { deleteConversation } from './deleteConversation';

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  stopSession: vi.fn(),
  captureTelemetry: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  get db() {
    return mocks.db ?? {};
  },
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: {
    capture: mocks.captureTelemetry,
  },
}));

async function installTaskProvider(): Promise<void> {
  const taskProvider: TaskProvider = {
    taskId: 'task-1',
    taskBranch: undefined,
    sourceBranch: undefined,
    taskEnvVars: {},
    conversations: {
      startSession: vi.fn(),
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

describe('deleteConversation runtime cleanup', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    await taskManager.teardownTask('task-1', 'terminate');
    vi.clearAllMocks();
    fixture = await openFixture('empty');
    mocks.db = fixture.db;
    mocks.stopSession.mockResolvedValue(undefined);
    await installTaskProvider();

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
      provider: 'codex',
      runtimeMode: 'chat',
    });
    await chatConversationRuntime.hydrateConversation({
      id: 'conversation-1',
      projectId: 'project-1',
      taskId: 'task-1',
      providerId: 'codex',
      title: 'Conversation 1',
      lastInteractedAt: null,
      isInitialConversation: false,
      runtimeMode: 'chat',
    });
  });

  afterEach(async () => {
    chatConversationRuntime.dehydrateConversation('conversation-1');
    fixture.close();
    mocks.db = undefined;
    await taskManager.teardownTask('task-1', 'terminate');
  });

  it('clears chat runtime state when deleting a chat conversation', async () => {
    expect(chatConversationRuntime.isActive('conversation-1')).toBe(true);

    await deleteConversation('project-1', 'task-1', 'conversation-1');

    expect(chatConversationRuntime.isActive('conversation-1')).toBe(false);
    expect(mocks.stopSession).toHaveBeenCalledWith('conversation-1');
  });
});
