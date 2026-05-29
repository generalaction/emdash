import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskProvider } from '@main/core/projects/project-provider';
import { taskManager } from '@main/core/tasks/task-manager';
import { conversations } from '@main/db/schema';
import { serializeConversationConfig } from '@shared/conversation-config';
import { ok } from '@shared/result';
import { chatConversationRuntime } from './chat/chat-conversation-runtime';
import { chatTimelineStore } from './chat/chat-timeline-store';
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
  provider: 'codex' | 'claude' | 'grok' = 'codex',
  config: Parameters<typeof serializeConversationConfig>[0] = {}
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
    config: Object.keys(config).length > 0 ? serializeConversationConfig(config) : undefined,
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
    await chatConversationRuntime.dehydrateConversation('conversation-1');
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

  it('hydrates Codex chat conversations with the stored provider session id for resume', async () => {
    await seedConversation(fixture, 'chat', 'codex', {
      providerSessionId: '019c95f6-cd96-7812-ba15-574286674599',
    });

    await hydrateConversation('project-1', 'task-1', 'conversation-1');

    expect(mocks.startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'conversation-1',
        providerId: 'codex',
        providerSessionId: '019c95f6-cd96-7812-ba15-574286674599',
        runtimeMode: 'chat',
        resume: true,
      }),
      undefined,
      true
    );
    expect(chatConversationRuntime.isActive('conversation-1')).toBe(true);
  });

  it('restores permission recovery rows when chat backend resume fails', async () => {
    await seedConversation(fixture, 'chat');
    await chatTimelineStore.append(
      {
        id: 'conversation-1',
        projectId: 'project-1',
        taskId: 'task-1',
        providerId: 'codex',
        title: 'Conversation 1',
        lastInteractedAt: null,
        isInitialConversation: false,
        runtimeMode: 'chat',
      },
      {
        id: 'permission-1',
        kind: 'permission_request',
        payload: {
          requestId: 'permission-1',
          title: 'Run command?',
          options: [{ id: 'approve', label: 'Approve', kind: 'primary' }],
          status: 'pending',
        },
      },
      { upsert: true }
    );
    mocks.startSession.mockRejectedValueOnce(new Error('resume failed'));

    await expect(hydrateConversation('project-1', 'task-1', 'conversation-1')).rejects.toThrow(
      'resume failed'
    );

    expect(chatConversationRuntime.isActive('conversation-1')).toBe(false);
    await expect(
      chatTimelineStore.getPendingPermissionRequest(
        {
          id: 'conversation-1',
          projectId: 'project-1',
          taskId: 'task-1',
          providerId: 'codex',
          title: 'Conversation 1',
          lastInteractedAt: null,
          isInitialConversation: false,
          runtimeMode: 'chat',
        },
        { requestId: 'permission-1', optionId: 'approve' }
      )
    ).resolves.toMatchObject({ requestId: 'permission-1', status: 'pending' });
  });

  it('falls back to a PTY session for chat-capable rows without a chat runtime adapter', async () => {
    await seedConversation(fixture, 'chat', 'claude');

    await hydrateConversation('project-1', 'task-1', 'conversation-1');

    expect(mocks.startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'conversation-1',
        providerId: 'claude',
        runtimeMode: 'chat',
        resume: true,
      }),
      undefined,
      true
    );
  });
});
