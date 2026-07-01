import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteTask } from './deleteTask';

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  deleteIndex: vi.fn(),
  deleteWhere: vi.fn(),
  delViewState: vi.fn(),
  getProject: vi.fn(),
  selectLimit: vi.fn(),
  teardownTask: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mocks.selectLimit,
        }),
      }),
    }),
    delete: () => ({
      where: mocks.deleteWhere,
    }),
  },
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: {
    getProject: mocks.getProject,
  },
}));

vi.mock('@main/core/tasks/task-session-manager', () => ({
  taskSessionManager: {
    teardownTask: mocks.teardownTask,
  },
}));

vi.mock('@main/core/view-state/view-state-service', () => ({
  viewStateService: {
    del: mocks.delViewState,
  },
}));

vi.mock('@main/core/search/workspace-file-index-service', () => ({
  workspaceFileIndexService: {
    deleteIndex: mocks.deleteIndex,
  },
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: {
    capture: mocks.capture,
  },
}));

describe('deleteTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteWhere.mockResolvedValue(undefined);
    mocks.getProject.mockReturnValue(undefined);
    mocks.teardownTask.mockResolvedValue({ success: true });
  });

  it('deletes both the aggregate view-state key and the dedicated tabs key', async () => {
    mocks.selectLimit.mockResolvedValueOnce([{ id: 'task-1', workspaceId: null }]);

    await deleteTask('project-1', 'task-1');

    expect(mocks.delViewState).toHaveBeenCalledWith('task:task-1');
    expect(mocks.delViewState).toHaveBeenCalledWith('task:task-1:tabs');
  });

  it('preserves the workspace file index when an archived sibling still references the workspace', async () => {
    mocks.selectLimit
      .mockResolvedValueOnce([{ id: 'task-1', workspaceId: 'workspace-1' }])
      .mockResolvedValueOnce([
        { id: 'workspace-1', kind: 'worktree', branchName: null, config: null },
      ])
      .mockResolvedValueOnce([{ id: 'workspace-1', kind: 'worktree' }])
      .mockResolvedValueOnce([{ id: 'archived-sibling' }]);

    await deleteTask('project-1', 'task-1', { deleteWorktree: false });

    expect(mocks.deleteIndex).not.toHaveBeenCalled();
  });

  it('does not delete the task row when custom worktree teardown fails', async () => {
    const teardownError = new Error('graft remove failed');
    mocks.getProject.mockReturnValue({
      projectId: 'project-1',
      hasCustomWorktreeTeardownCommand: vi.fn().mockResolvedValue(true),
      removeTaskWorktree: vi.fn().mockRejectedValue(teardownError),
    });
    mocks.selectLimit
      .mockResolvedValueOnce([{ id: 'task-1', workspaceId: 'workspace-1' }])
      .mockResolvedValueOnce([
        {
          id: 'workspace-1',
          kind: 'worktree',
          branchName: 'task/custom',
          path: '/worktrees/task/custom',
          config: null,
        },
      ])
      .mockResolvedValueOnce([]);

    await expect(deleteTask('project-1', 'task-1', { deleteWorktree: true })).rejects.toThrow(
      teardownError
    );

    expect(mocks.deleteWhere).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });
});
