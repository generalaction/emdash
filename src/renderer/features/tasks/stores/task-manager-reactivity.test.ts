import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import { conversationCreatedChannel } from '@shared/events/conversationEvents';
import {
  taskCreatedChannel,
  taskDeletedChannel,
  taskUpdatedChannel,
} from '@shared/events/taskEvents';
import type { Task } from '@shared/tasks';
import type { ProjectSettingsStore } from '@renderer/features/projects/stores/project-settings-store';
import type { RepositoryStore } from '@renderer/features/projects/stores/repository-store';
import { createUnregisteredTask, isRegistered } from './task';
import { TaskManagerStore } from './task-manager';

const { eventHandlers } = vi.hoisted(() => ({
  eventHandlers: new Map<string, Set<(data: unknown) => void>>(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn((event: { name: string }, handler: (data: unknown) => void) => {
      const handlers = eventHandlers.get(event.name) ?? new Set<(data: unknown) => void>();
      handlers.add(handler);
      eventHandlers.set(event.name, handlers);
      return () => handlers.delete(handler);
    }),
  },
  rpc: {
    tasks: {
      getTasks: vi.fn(async () => []),
    },
    pullRequests: {
      getPullRequestsForTask: vi.fn(async () => ({ success: true, data: { prs: [] } })),
    },
    conversations: {
      getConversationsForTask: vi.fn(async () => []),
    },
    ssh: {
      connect: vi.fn(async () => {}),
      deleteConnection: vi.fn(async () => {}),
      getConnections: vi.fn(async () => []),
      getConnectionState: vi.fn(async () => ({})),
      getHealthStates: vi.fn(async () => ({})),
      renameConnection: vi.fn(async () => {}),
      saveConnection: vi.fn(async (config) => ({ ...config, id: 'ssh-1' })),
      testConnection: vi.fn(async () => ({ success: true })),
    },
  },
}));

vi.mock('@renderer/lib/pty/pty-session', () => ({
  PtySession: class {
    pty = null;
    status = 'disconnected';
    connect = vi.fn(async () => {});
    dispose = vi.fn();

    constructor(readonly sessionId: string) {}
  },
}));

const { rpc } = await import('@renderer/lib/ipc');

function emitEvent<T>(event: { name: string }, payload: T): void {
  for (const handler of eventHandlers.get(event.name) ?? []) {
    handler(payload);
  }
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    projectId: 'project-1',
    name: 'Ship MCP sync',
    status: 'in_progress',
    sourceBranch: { type: 'local', branch: 'main' },
    taskBranch: 'ship-mcp-sync',
    createdAt: '2026-05-11T00:00:00.000Z',
    updatedAt: '2026-05-11T00:00:00.000Z',
    statusChangedAt: '2026-05-11T00:00:00.000Z',
    lastInteractedAt: '2026-05-11T00:00:00.000Z',
    isPinned: false,
    prs: [],
    conversations: {},
    ...overrides,
  };
}

function getRegisteredTask(manager: TaskManagerStore, taskId: string): Task {
  const store = manager.tasks.get(taskId);
  if (!store || !isRegistered(store)) {
    throw new Error(`Expected registered task ${taskId}`);
  }
  return store.data;
}

describe('TaskManagerStore external reactivity', () => {
  beforeEach(() => {
    eventHandlers.clear();
    vi.clearAllMocks();
  });

  it('merges external task creation, updates, and conversation counts without reload', async () => {
    const manager = new TaskManagerStore(
      'project-1',
      { repositoryUrl: null } as unknown as RepositoryStore,
      {} as unknown as ProjectSettingsStore,
      'main'
    );
    const task = makeTask();

    emitEvent(taskCreatedChannel, task);

    const createdStore = manager.tasks.get(task.id);
    expect(createdStore?.state).toBe('unprovisioned');
    expect(createdStore?.data.name).toBe('Ship MCP sync');

    const createdInstance = createdStore;
    vi.mocked(rpc.tasks.getTasks).mockResolvedValueOnce([
      makeTask({ id: task.id, status: 'review', conversations: {} }),
    ]);
    await manager.loadTasks();

    expect(manager.tasks.get(task.id)).toBe(createdInstance);
    expect(getRegisteredTask(manager, task.id).status).toBe('review');

    emitEvent<Conversation>(conversationCreatedChannel, {
      id: 'conversation-1',
      projectId: 'project-1',
      taskId: task.id,
      providerId: 'codex',
      title: 'codex (1)',
      lastInteractedAt: null,
      isInitialConversation: true,
    });

    expect(getRegisteredTask(manager, task.id).conversations).toEqual({ codex: 1 });

    emitEvent(
      taskUpdatedChannel,
      makeTask({
        id: task.id,
        status: 'done',
        archivedAt: '2026-05-11T00:05:00.000Z',
        prs: [],
        conversations: {},
      })
    );

    expect(getRegisteredTask(manager, task.id).status).toBe('done');
    expect(getRegisteredTask(manager, task.id).archivedAt).toBe('2026-05-11T00:05:00.000Z');
    expect(getRegisteredTask(manager, task.id).conversations).toEqual({ codex: 1 });

    emitEvent(taskDeletedChannel, { taskId: task.id, projectId: 'project-1' });

    expect(manager.tasks.has(task.id)).toBe(false);
  });

  it('dedupes local optimistic creation when the external task event arrives first', () => {
    const manager = new TaskManagerStore(
      'project-1',
      { repositoryUrl: null } as unknown as RepositoryStore,
      {} as unknown as ProjectSettingsStore,
      'main'
    );

    manager.tasks.set(
      'task-1',
      createUnregisteredTask({
        id: 'task-1',
        name: 'Ship MCP sync',
        status: 'in_progress',
        createdAt: '2026-05-11T00:00:00.000Z',
        statusChangedAt: '2026-05-11T00:00:00.000Z',
        lastInteractedAt: '2026-05-11T00:00:00.000Z',
        isPinned: false,
      })
    );

    emitEvent(taskCreatedChannel, makeTask());

    expect(manager.tasks.get('task-1')?.state).toBe('unprovisioned');
  });
});
