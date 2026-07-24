import { runInAction } from 'mobx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { TaskManagerStore } from '@core/features/tasks/api/browser/stores/task-manager';
import { createUnprovisionedTask } from '@core/features/tasks/api/browser/stores/task-store';
import { taskSubject } from '@core/features/tasks/contributions/subject';
import type { Task } from '@core/primitives/tasks/api';

let taskDeletedHandler:
  | ((event: { type: 'deleted'; taskId: string; projectId: string }) => void)
  | undefined;

const mocks = vi.hoisted(() => ({
  archiveTask: vi.fn(),
  deleteBySubject: vi.fn(),
  deleteTasks: vi.fn(),
  getProjectManagerStore: vi.fn(),
  getTasks: vi.fn(),
  invalidateSubject: vi.fn(),
  mountProject: vi.fn(),
  navigate: vi.fn(),
  teardownTask: vi.fn(),
}));

vi.mock('@core/manifests/browser/task-scoped-stores', () => ({
  taskStoreContributions: [],
}));

vi.mock('@core/features/conversations/browser/acp/acp-chat-store', () => ({
  AcpChatStore: class {
    conversationId = '';
    dispose() {}
    bootstrap() {}
  },
}));

vi.mock('@core/features/conversations/browser/acp/acp-chat-panel', () => ({
  AcpChatPanel: () => null,
}));

vi.mock('@renderer/lib/runtime/desktop-wire-client', () => ({
  getDesktopWireClient: async () => ({
    tasks: {
      archiveTask: mocks.archiveTask,
      deleteTasks: mocks.deleteTasks,
      getTasks: mocks.getTasks,
      teardownTask: mocks.teardownTask,
      events: {
        subscribe: async (
          _key: undefined,
          observer: {
            onEvent: (event: { type: 'deleted'; taskId: string; projectId: string }) => void;
          }
        ) => {
          taskDeletedHandler = observer.onEvent;
          return vi.fn();
        },
      },
    },
  }),
}));

vi.mock('@core/primitives/mementos/browser', () => ({
  getMementoClient: () => ({
    deleteBySubject: mocks.deleteBySubject,
    reportError: vi.fn(),
  }),
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    navigation: {
      currentRef: {
        viewId: 'task',
        params: { projectId: 'project-1', taskId: 'task-1' },
      },
      invalidateSubject: mocks.invalidateSubject,
      navigate: mocks.navigate,
    },
  },
}));

vi.mock('@core/features/projects/api/browser/stores/project-selectors', () => ({
  getProjectManagerStore: mocks.getProjectManagerStore,
  getProjectSshConnectionId: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    projectId: 'project-1',
    name: 'Task 1',
    status: 'todo',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    statusChangedAt: '2026-01-01T00:00:00.000Z',
    isPinned: false,
    prs: [],
    conversations: {},
    workspaceId: 'workspace-1',
    type: 'task',
    ...overrides,
  };
}

function makeTaskManager(): TaskManagerStore {
  return new TaskManagerStore('project-1', {
    pageData: { invalidate: vi.fn() },
  } as never);
}

describe('TaskManagerStore lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskDeletedHandler = undefined;
    mocks.archiveTask.mockResolvedValue(undefined);
    mocks.deleteBySubject.mockResolvedValue(undefined);
    mocks.deleteTasks.mockResolvedValue(undefined);
    mocks.getTasks.mockResolvedValue([]);
    mocks.getProjectManagerStore.mockReturnValue({ mountProject: mocks.mountProject });
    mocks.mountProject.mockResolvedValue(undefined);
  });

  it('archives without owning conversation, terminal, or workspace stores', async () => {
    const manager = makeTaskManager();
    const task = makeTask();
    const store = createUnprovisionedTask(task);
    store.transitionToProvisioned(task, '/tmp/workspace-1', 'workspace-1');
    manager.tasks.set(task.id, store);

    await manager.archiveTask(task.id);

    expect(mocks.archiveTask).toHaveBeenCalledWith({
      projectId: 'project-1',
      taskId: 'task-1',
    });
    expect(store.state).toBe('unprovisioned');
    expect(store.workspaceId).toBeNull();
    expect(mocks.navigate).toHaveBeenCalledWith(projectViewDef({ projectId: 'project-1' }));
    manager.dispose();
  });

  it('deletes task mementos after a backend deletion event', async () => {
    const manager = makeTaskManager();
    runInAction(() => {
      manager.tasks.set('task-1', createUnprovisionedTask(makeTask()));
    });

    await vi.waitFor(() => expect(taskDeletedHandler).toBeTypeOf('function'));
    taskDeletedHandler?.({ type: 'deleted', taskId: 'task-1', projectId: 'project-1' });
    await vi.waitFor(() =>
      expect(mocks.deleteBySubject).toHaveBeenCalledWith(taskSubject({ taskId: 'task-1' }))
    );
    expect(manager.tasks.has('task-1')).toBe(false);
    manager.dispose();
  });
});
