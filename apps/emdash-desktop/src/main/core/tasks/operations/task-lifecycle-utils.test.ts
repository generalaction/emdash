import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceConfig } from '@shared/core/workspaces/workspace-config';
import { deleteWorkspaceIfUnused, removeWorktreeIfUnused } from './task-lifecycle-utils';

const mocks = vi.hoisted(() => ({
  deleteWhere: vi.fn(),
  selectLimit: vi.fn(),
  deleteIndex: vi.fn(),
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

vi.mock('@main/core/search/workspace-file-index-service', () => ({
  workspaceFileIndexService: {
    deleteIndex: mocks.deleteIndex,
  },
}));

describe('task lifecycle workspace cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteWhere.mockResolvedValue(undefined);
  });

  it('does not remove a project-root workspace when branchName is a current-branch cache', async () => {
    const project = { removeTaskWorktree: vi.fn() };

    await expect(
      removeWorktreeIfUnused(
        {
          id: 'ws-root',
          kind: 'project-root',
          branchName: 'feature/current',
          config: null,
        },
        project as never,
        false
      )
    ).resolves.toBe(false);

    expect(project.removeTaskWorktree).not.toHaveBeenCalled();
    expect(mocks.selectLimit).not.toHaveBeenCalled();
  });

  it('removes worktrees by provisioned branch, not current-branch cache', async () => {
    const config: WorkspaceConfig = {
      version: '2',
      git: {
        kind: 'create-branch',
        branchName: 'task/provisioned',
        fromBranch: { type: 'local', branch: 'main' },
      },
      workspace: { kind: 'new-worktree' },
    };
    const project = {
      removeTaskWorktree: vi.fn().mockResolvedValue(undefined),
    };
    mocks.selectLimit.mockResolvedValue([]);

    await expect(
      removeWorktreeIfUnused(
        {
          id: 'ws-task',
          kind: 'worktree',
          branchName: 'feature/current',
          config,
        },
        project as never,
        false
      )
    ).resolves.toBe(true);

    expect(project.removeTaskWorktree).toHaveBeenCalledWith('task/provisioned');
  });

  it('deletes the workspace index when deleting the unreferenced workspace row', async () => {
    mocks.selectLimit
      .mockResolvedValueOnce([{ id: 'workspace-1', kind: 'worktree' }])
      .mockResolvedValueOnce([]);

    await deleteWorkspaceIfUnused('workspace-1', 'task-1');

    expect(mocks.deleteWhere).toHaveBeenCalledOnce();
    expect(mocks.deleteIndex).toHaveBeenCalledWith('workspace-1');
  });

  it('preserves the workspace index while an archived sibling still references the workspace', async () => {
    mocks.selectLimit
      .mockResolvedValueOnce([{ id: 'workspace-1', kind: 'worktree' }])
      .mockResolvedValueOnce([{ id: 'archived-sibling' }]);

    await deleteWorkspaceIfUnused('workspace-1', 'task-1');

    expect(mocks.deleteWhere).not.toHaveBeenCalled();
    expect(mocks.deleteIndex).not.toHaveBeenCalled();
  });
});
