import { beforeEach, describe, expect, it, vi } from 'vitest';
import { archiveTask } from './archiveTask';

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  deleteIndex: vi.fn(),
  getProject: vi.fn(),
  selectLimit: vi.fn(),
  teardownTask: vi.fn(),
  updateWhere: vi.fn(),
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
    update: () => ({
      set: () => ({
        where: mocks.updateWhere,
      }),
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

describe('archiveTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateWhere.mockResolvedValue(undefined);
  });

  it('waits for teardown before removing the worktree', async () => {
    const order: string[] = [];
    let resolveTeardown: (value: { success: true }) => void = () => {};
    const teardownPromise = new Promise<{ success: true }>((resolve) => {
      resolveTeardown = resolve;
    });
    const removeTaskWorktree = vi.fn(async () => {
      order.push('remove-worktree');
    });

    mocks.selectLimit
      .mockResolvedValueOnce([
        {
          id: 'task-1',
          workspaceId: 'workspace-1',
        },
      ])
      .mockResolvedValueOnce([{ id: 'workspace-1', branchName: 'emdash/task-1' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mocks.getProject.mockReturnValue({ removeTaskWorktree });
    mocks.updateWhere.mockImplementation(async () => {
      order.push('archive-update');
    });
    mocks.teardownTask.mockImplementation(() => {
      order.push('teardown-start');
      return teardownPromise;
    });

    const archivePromise = archiveTask('project-1', 'task-1');
    await vi.waitFor(() => expect(mocks.teardownTask).toHaveBeenCalledTimes(1));

    expect(removeTaskWorktree).not.toHaveBeenCalled();

    resolveTeardown({ success: true });
    await archivePromise;

    expect(removeTaskWorktree).toHaveBeenCalledWith('emdash/task-1');
    expect(order).toEqual(['archive-update', 'teardown-start', 'remove-worktree']);
  });
});
