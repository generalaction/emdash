import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskProvider } from '@main/core/projects/project-provider';
import { appSettingsService } from '@main/core/settings/settings-service';
import { taskManager } from '@main/core/tasks/task-manager';
import { conversations } from '@main/db/schema';
import { ok } from '@shared/result';
import { chatConversationRuntime } from './chat/chat-conversation-runtime';
import { createConversation } from './createConversation';

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  startSession: vi.fn(),
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

async function setConversationUiMode(mode: 'terminal' | 'chat') {
  const current = await appSettingsService.get('interface');
  await appSettingsService.update('interface', { ...current, conversationUiMode: mode });
}

async function installTaskProvider(): Promise<void> {
  const taskProvider: TaskProvider = {
    taskId: 'task-1',
    taskBranch: undefined,
    sourceBranch: undefined,
    taskEnvVars: {},
    conversations: {
      startSession: mocks.startSession,
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

describe('createConversation runtime mode', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    await taskManager.teardownTask('task-1', 'terminate');
    vi.clearAllMocks();
    fixture = await openFixture('empty');
    mocks.db = fixture.db;
    mocks.startSession.mockResolvedValue(undefined);
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
    await appSettingsService.reset('interface');
  });

  afterEach(async () => {
    chatConversationRuntime.dehydrateConversation('conversation-1');
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
  });

  it('persists chat runtime and starts the Codex chat runtime', async () => {
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

    expect(row?.runtimeMode).toBe('chat');
    expect(row?.config).toContain('"initialPrompt":"hello"');
    expect(conversation.runtimeMode).toBe('chat');
    expect(conversation.initialPrompt).toBe('hello');
    expect(mocks.startSession).not.toHaveBeenCalled();
    expect(chatConversationRuntime.isActive('conversation-1')).toBe(true);
    expect(chatConversationRuntime.getInitialPrompt('conversation-1')).toBe('hello');
  });

  it('falls back to terminal runtime for terminal-only providers', async () => {
    await setConversationUiMode('chat');

    const conversation = await createConversation({
      id: 'conversation-1',
      projectId: 'project-1',
      taskId: 'task-1',
      title: 'Terminal fallback',
      provider: 'grok',
    });

    const [row] = await fixture.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, 'conversation-1'));

    expect(row?.runtimeMode).toBe('terminal');
    expect(conversation.runtimeMode).toBe('terminal');
    expect(mocks.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ runtimeMode: 'terminal' }),
      undefined,
      false,
      undefined
    );
  });

  it('clears active chat runtime state when the task is torn down', async () => {
    await setConversationUiMode('chat');

    await createConversation({
      id: 'conversation-1',
      projectId: 'project-1',
      taskId: 'task-1',
      title: 'Chat conversation',
      provider: 'codex',
    });

    expect(chatConversationRuntime.isActive('conversation-1')).toBe(true);

    await taskManager.teardownTask('task-1', 'terminate');

    expect(chatConversationRuntime.isActive('conversation-1')).toBe(false);
  });
});
