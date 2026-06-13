import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '@shared/core/tasks/tasks';
import { TaskManagerStore } from './task-manager';
import { createUnprovisionedTask } from './task-store';

type MockViewModel = {
  initialize: ReturnType<typeof vi.fn>;
  suspend: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  restoreSnapshot: ReturnType<typeof vi.fn>;
};

type MockDraftComments = {
  dispose: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => ({
  archiveTask: vi.fn(),
  conversationAcquire: vi.fn(),
  conversationRelease: vi.fn(),
  draftComments: [] as MockDraftComments[],
  getConversationsForProject: vi.fn(),
  getProjectManagerStore: vi.fn(),
  getPullRequestsForTask: vi.fn(),
  getTaskGitWorktreeStore: vi.fn(),
  getTasks: vi.fn(),
  mountProject: vi.fn(),
  provisionWorkspace: vi.fn(),
  teardownTask: vi.fn(),
  terminalAcquire: vi.fn(),
  terminalRelease: vi.fn(),
  viewModels: [] as MockViewModel[],
  viewStateGet: vi.fn(),
  workspaceActivate: vi.fn(),
  workspaceAcquire: vi.fn(),
  workspaceRelease: vi.fn(),
  workspaceSetBootstrapState: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn(() => () => {}),
  },
  rpc: {
    conversations: {
      getConversationsForProject: mocks.getConversationsForProject,
    },
    pullRequests: {
      getPullRequestsForTask: mocks.getPullRequestsForTask,
    },
    tasks: {
      archiveTask: mocks.archiveTask,
      getTasks: mocks.getTasks,
      provisionWorkspace: mocks.provisionWorkspace,
      teardownTask: mocks.teardownTask,
    },
  },
}));

vi.mock('@renderer/features/projects/stores/project-selectors', () => ({
  getProjectManagerStore: mocks.getProjectManagerStore,
}));

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  getTaskGitWorktreeStore: mocks.getTaskGitWorktreeStore,
}));

vi.mock('@renderer/lib/stores/view-state-cache', () => ({
  viewStateCache: {
    get: mocks.viewStateGet,
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock('@renderer/features/tasks/diff-view/stores/draft-comments-store', () => ({
  DraftCommentsStore: class {
    dispose = vi.fn();

    constructor() {
      mocks.draftComments.push(this);
    }
  },
}));

vi.mock('./workspace-view-model', () => ({
  WorkspaceViewModel: class {
    initialize = vi.fn();
    suspend = vi.fn();
    dispose = vi.fn();
    restoreSnapshot = vi.fn();

    constructor() {
      mocks.viewModels.push(this);
    }
  },
}));

vi.mock('./workspace-registry', () => ({
  workspaceRegistry: {
    activate: mocks.workspaceActivate,
    acquire: mocks.workspaceAcquire,
    release: mocks.workspaceRelease,
    setBootstrapState: mocks.workspaceSetBootstrapState,
  },
}));

vi.mock('./conversation-registry', () => ({
  conversationRegistry: {
    acquire: mocks.conversationAcquire,
    get: vi.fn(),
    release: mocks.conversationRelease,
  },
}));

vi.mock('./terminal-registry', () => ({
  terminalRegistry: {
    acquire: mocks.terminalAcquire,
    get: vi.fn(),
    release: mocks.terminalRelease,
  },
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
  return new TaskManagerStore(
    'project-1',
    { pullRequestRepositoryUrl: null } as never,
    { pageData: { invalidate: vi.fn() } } as never,
    'main'
  );
}

describe('TaskManagerStore archive lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.draftComments.length = 0;
    mocks.viewModels.length = 0;
    mocks.archiveTask.mockResolvedValue(undefined);
    mocks.getConversationsForProject.mockResolvedValue([]);
    mocks.getProjectManagerStore.mockReturnValue({ mountProject: mocks.mountProject });
    mocks.getPullRequestsForTask.mockResolvedValue({ success: true, data: { prs: [] } });
    mocks.getTasks.mockResolvedValue([]);
    mocks.mountProject.mockResolvedValue(undefined);
    mocks.provisionWorkspace.mockResolvedValue({
      success: true,
      data: {
        path: '/tmp/workspace-1',
        workspaceId: 'workspace-1',
      },
    });
    mocks.viewStateGet.mockResolvedValue(undefined);
  });

  it('archives by disposing frontend runtime instead of soft-tearing down the task', async () => {
    const manager = makeTaskManager();
    const task = makeTask();
    const store = createUnprovisionedTask(task);
    store.transitionToProvisioned(task, '/tmp/workspace-1', 'workspace-1', {} as never, 'main');
    const viewModel = mocks.viewModels[0];
    const draftComments = mocks.draftComments[0];
    manager.tasks.set(task.id, store);

    await manager.archiveTask(task.id);

    expect(mocks.archiveTask).toHaveBeenCalledWith('project-1', 'task-1');
    expect(mocks.teardownTask).not.toHaveBeenCalled();
    expect(mocks.conversationRelease).toHaveBeenCalledWith('task-1');
    expect(mocks.terminalRelease).toHaveBeenCalledWith('task-1');
    expect(viewModel.dispose).toHaveBeenCalledOnce();
    expect(draftComments.dispose).toHaveBeenCalledOnce();
    expect(store.state).toBe('unprovisioned');
    expect(store.phase).toBe('idle');
    expect(store.workspaceId).toBeNull();
    expect(store.viewModel).toBeNull();
    expect(store.draftComments).toBeNull();
    expect((store.data as Task).archivedAt).toBeDefined();

    manager.dispose();
  });

  it('reacquires frontend managers before provisioning a dry restored task', async () => {
    const manager = makeTaskManager();
    const task = makeTask({ archivedAt: undefined });
    const store = createUnprovisionedTask(task);
    store.transitionToDryUnprovisioned(task);
    manager.tasks.set(task.id, store);
    const snapshot = { sidebarTab: 'conversations' };
    mocks.viewStateGet.mockResolvedValue(snapshot);

    await manager.provisionTask(task.id);

    expect(mocks.conversationAcquire).toHaveBeenCalledWith('task-1', 'project-1');
    expect(mocks.terminalAcquire).toHaveBeenCalledWith('task-1', 'project-1');
    expect(store.state).toBe('provisioned');
    expect(store.viewModel).toBe(mocks.viewModels[1]);
    expect(mocks.viewModels[1].restoreSnapshot).toHaveBeenCalledWith(snapshot);
    expect(mocks.viewModels[1].initialize).toHaveBeenCalledOnce();

    manager.dispose();
  });
});
