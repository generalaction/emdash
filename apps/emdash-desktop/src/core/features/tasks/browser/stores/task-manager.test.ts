import { ok } from '@emdash/shared';
import { cell } from '@emdash/wire/state';
import { expose } from '@emdash/wire/state';
import { createTestWire } from '@emdash/wire/testing';
import { runInAction } from 'mobx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { tasksWireContract } from '@core/features/tasks/api';
import { TaskManagerStore } from '@core/features/tasks/api/browser/stores/task-manager';
import { createUnprovisionedTask } from '@core/features/tasks/api/browser/stores/task-store';
import type { Task, TaskListData, TaskStatsData } from '@core/primitives/tasks/api';

const mocks = vi.hoisted(() => ({
  archiveMutation: vi.fn(),
  deleteBySubject: vi.fn(),
  deleteTasks: vi.fn(),
  getProjectManagerStore: vi.fn(),
  getTasks: vi.fn(),
  invalidateSubject: vi.fn(),
  mountProject: vi.fn(),
  navigate: vi.fn(),
  teardownTask: vi.fn(),
}));

let taskListState: ReturnType<typeof cell<TaskListData>>;
let taskStatsState: ReturnType<typeof cell<TaskStatsData>>;
let wire: ReturnType<typeof createTaskWire> | undefined;

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
    tasks: wire!.client,
  }),
}));

vi.mock('@core/primitives/mementos/browser', () => ({
  getMementoClient: () => ({
    deleteBySubject: mocks.deleteBySubject,
    reportError: vi.fn(),
  }),
}));

vi.mock('@core/primitives/navigation/browser/navigation-selectors', () => ({
  getNavigation: () => ({
    currentRef: {
      viewId: 'task',
      params: { projectId: 'project-1', taskId: 'task-1' },
    },
    invalidateSubject: mocks.invalidateSubject,
    navigate: mocks.navigate,
  }),
}));

vi.mock('@core/features/projects/api/browser/stores/project-selectors', () => ({
  getProjectManagerStore: mocks.getProjectManagerStore,
  getProjectSshConnectionId: vi.fn(),
}));

vi.mock('@emdash/ui/react/primitives', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}));

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

function createTaskWire() {
  const taskListProvider = expose(
    tasksWireContract.taskList,
    { list: taskListState },
    {
      mutations: {
        async archive(context) {
          mocks.archiveMutation(context.input);
          const revision = taskListState.update(
            (previous) => ({
              tasks: previous.tasks.map((task) =>
                task.id === context.input.taskId
                  ? { ...task, archivedAt: '2026-01-02T00:00:00.000Z' }
                  : task
              ),
            }),
            { mutationIds: [context.mutationId] }
          );
          await context.observed('list', revision);
          return ok<void>();
        },
      },
    }
  );
  const taskStatsProvider = expose(tasksWireContract.taskStats, { stats: taskStatsState });
  return createTestWire(tasksWireContract, {
    createTask: vi.fn(),
    getDeletePreflight: vi.fn(),
    deleteTask: vi.fn(),
    deleteTasks: (input: { projectId: string; taskIds: string[]; options?: unknown }) =>
      mocks.deleteTasks(input),
    getProjectWorkspaces: vi.fn(async () => []),
    teardownTask: mocks.teardownTask,
    generateTaskName: vi.fn(async () => 'Task'),
    taskList: taskListProvider,
    taskStats: taskStatsProvider,
    delete: vi.fn(),
  } as never);
}

describe('TaskManagerStore lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskListState = cell({ tasks: [] });
    taskStatsState = cell({ byWorkspaceId: {} });
    wire = createTaskWire();
    mocks.deleteBySubject.mockResolvedValue(undefined);
    mocks.deleteTasks.mockResolvedValue(undefined);
    mocks.getTasks.mockResolvedValue([]);
    mocks.getProjectManagerStore.mockReturnValue({ mountProject: mocks.mountProject });
    mocks.mountProject.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await wire?.dispose();
    wire = undefined;
  });

  it('archives without owning conversation, terminal, or workspace stores', async () => {
    const manager = makeTaskManager();
    const task = makeTask();
    taskListState.set({ tasks: [{ ...task, workspaceId: undefined }] });
    const store = createUnprovisionedTask(task);
    store.transitionToProvisioned(task, '/tmp/workspace-1', 'workspace-1');
    manager.tasks.set(task.id, store);

    await manager.archiveTask(task.id);

    expect(mocks.archiveMutation).toHaveBeenCalledWith({ taskId: 'task-1' });
    expect(store.state).toBe('unprovisioned');
    expect(store.workspaceId).toBeNull();
    expect(mocks.navigate).toHaveBeenCalledWith(projectViewDef({ projectId: 'project-1' }));
    manager.dispose();
  });

  it('deletes tasks through the operation result without event confirmations', async () => {
    const manager = makeTaskManager();
    runInAction(() => {
      manager.tasks.set('task-1', createUnprovisionedTask(makeTask()));
    });

    await manager.deleteTasks(['task-1']);

    expect(mocks.deleteTasks).toHaveBeenCalledWith({
      projectId: 'project-1',
      taskIds: ['task-1'],
      options: undefined,
    });
    expect(manager.tasks.has('task-1')).toBe(false);
    manager.dispose();
  });

  it('rolls back failed deletes without disposing the restored task store', async () => {
    const manager = makeTaskManager();
    const store = createUnprovisionedTask(makeTask());
    const dispose = vi.spyOn(store, 'dispose');
    mocks.deleteTasks.mockRejectedValueOnce(new Error('delete failed'));
    runInAction(() => {
      manager.tasks.set('task-1', store);
    });

    await expect(manager.deleteTasks(['task-1'])).rejects.toThrow('delete failed');

    expect(manager.tasks.get('task-1')).toBe(store);
    expect(dispose).not.toHaveBeenCalled();
    manager.dispose();
  });
});
