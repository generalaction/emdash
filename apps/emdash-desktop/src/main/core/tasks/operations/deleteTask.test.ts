import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteTask } from './deleteTask';

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  clearTaskResourceTeardown: vi.fn(),
  deleteIndex: vi.fn(),
  deleteWhere: vi.fn(),
  delViewState: vi.fn(),
  createBoundExec: vi.fn(),
  gitExec: vi.fn(),
  getProject: vi.fn(),
  getProjectById: vi.fn(),
  selectLimit: vi.fn(),
  teardownTaskResources: vi.fn(),
}));

vi.mock('@emdash/core/exec', () => ({
  createBoundExec: mocks.createBoundExec,
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

vi.mock('@main/core/projects/operations/getProjects', () => ({
  getProjectById: mocks.getProjectById,
}));

vi.mock('@main/core/tasks/task-resource-teardown-state', () => ({
  clearTaskResourceTeardown: mocks.clearTaskResourceTeardown,
}));

vi.mock('./teardownTaskResources', () => ({
  teardownTaskResources: mocks.teardownTaskResources,
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
    mocks.gitExec.mockResolvedValue({ stdout: '', stderr: '' });
    mocks.createBoundExec.mockReturnValue({ exec: mocks.gitExec });
    mocks.getProject.mockReturnValue(undefined);
    mocks.getProjectById.mockResolvedValue(undefined);
    mocks.teardownTaskResources.mockResolvedValue({ success: true });
  });

  it('deletes both the aggregate view-state key and the dedicated tabs key', async () => {
    mocks.selectLimit.mockResolvedValueOnce([{ id: 'task-1', workspaceId: null }]);

    await deleteTask('project-1', 'task-1');

    expect(mocks.delViewState).toHaveBeenCalledWith('task:task-1');
    expect(mocks.delViewState).toHaveBeenCalledWith('task:task-1:tabs');
    expect(mocks.clearTaskResourceTeardown).toHaveBeenCalledWith('task-1');
  });

  it('tears down cold task resources before deleting persisted workspace state', async () => {
    const task = {
      id: 'task-1',
      name: 'Task 1',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
    };
    mocks.selectLimit
      .mockResolvedValueOnce([task])
      .mockResolvedValueOnce([
        { id: 'workspace-1', kind: 'worktree', branchName: null, config: null },
      ])
      .mockResolvedValueOnce([{ id: 'workspace-1', kind: 'worktree' }])
      .mockResolvedValueOnce([]);

    await deleteTask('project-1', 'task-1', { deleteWorktree: false });

    expect(mocks.teardownTaskResources).toHaveBeenCalledWith(task, 'terminate');
    expect(mocks.teardownTaskResources.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteWhere.mock.invocationCallOrder[0]
    );
  });

  it('preserves task and worktree state when resource teardown cannot run', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'emdash-delete-task-blocked-'));
    const worktreePath = path.join(tempDir, 'task-worktree');
    await mkdir(worktreePath, { recursive: true });
    await writeFile(path.join(worktreePath, 'file.txt'), 'content');
    mocks.selectLimit.mockResolvedValueOnce([
      {
        id: 'task-1',
        name: 'Task 1',
        projectId: 'project-1',
        workspaceId: 'workspace-1',
      },
    ]);
    mocks.teardownTaskResources.mockResolvedValue({
      success: false,
      error: { type: 'error', message: 'project is not mounted' },
    });

    try {
      await expect(deleteTask('project-1', 'task-1')).rejects.toThrow(
        'Failed to delete task resources'
      );

      await expect(access(worktreePath)).resolves.toBeUndefined();
      expect(mocks.deleteWhere).not.toHaveBeenCalled();
      expect(mocks.selectLimit).toHaveBeenCalledTimes(1);
      expect(mocks.clearTaskResourceTeardown).not.toHaveBeenCalled();
      expect(mocks.capture).not.toHaveBeenCalled();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
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

  it('removes an owned local worktree by recorded path when the project is not mounted', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'emdash-delete-task-'));
    const projectPath = path.join(tempDir, 'project');
    const worktreePath = path.join(tempDir, 'task-worktree');
    await mkdir(path.join(worktreePath, '.git'), { recursive: true });
    await mkdir(projectPath, { recursive: true });
    await writeFile(path.join(worktreePath, 'file.txt'), 'content');

    mocks.getProjectById.mockResolvedValue({
      type: 'local',
      id: 'project-1',
      name: 'Project',
      path: projectPath,
      baseRef: 'main',
      repositoryWorkspaceId: null,
      createdAt: '',
      updatedAt: '',
    });
    mocks.selectLimit
      .mockResolvedValueOnce([{ id: 'task-1', workspaceId: 'workspace-1' }])
      .mockResolvedValueOnce([
        {
          id: 'workspace-1',
          type: 'local',
          kind: 'worktree',
          location: 'local',
          path: worktreePath,
          branchName: 'task/branch',
          config: null,
        },
      ])
      .mockResolvedValueOnce([{ id: 'workspace-1', kind: 'worktree' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    try {
      await deleteTask('project-1', 'task-1');

      await expect(access(worktreePath)).rejects.toThrow();
      expect(mocks.createBoundExec).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: projectPath })
      );
      expect(mocks.gitExec).toHaveBeenCalledWith(['worktree', 'prune'], { timeoutMs: 5_000 });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
