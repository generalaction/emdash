import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteTask } from './deleteTask';

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  deleteIndex: vi.fn(),
  deleteWhere: vi.fn(),
  delViewState: vi.fn(),
  fileSystemFactory: vi.fn(),
  gitRepository: vi.fn(),
  pruneWorktrees: vi.fn(),
  getProject: vi.fn(),
  getProjectById: vi.fn(),
  selectLimit: vi.fn(),
  teardownTask: vi.fn(),
}));

vi.mock('@main/core/files/runtime-files', () => ({
  RuntimeFileSystem: vi.fn(function RuntimeFileSystem(rootPath: string) {
    return mocks.fileSystemFactory(rootPath);
  }),
}));

vi.mock('@main/core/git/runtime-git', () => ({
  RuntimeGit: vi.fn(function RuntimeGit() {
    return { repository: mocks.gitRepository };
  }),
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
    mocks.fileSystemFactory.mockReturnValue({
      exists: async (targetPath: string) => {
        try {
          await access(targetPath);
          return ok(true);
        } catch {
          return ok(false);
        }
      },
      remove: async (targetPath: string) => {
        await rm(targetPath, { recursive: true, force: true });
        return ok();
      },
    });
    mocks.gitRepository.mockReturnValue({ pruneWorktrees: mocks.pruneWorktrees });
    mocks.pruneWorktrees.mockResolvedValue(ok());
    mocks.getProject.mockReturnValue(undefined);
    mocks.getProjectById.mockResolvedValue(undefined);
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
      expect(mocks.gitRepository).toHaveBeenCalledWith(projectPath);
      expect(mocks.pruneWorktrees).toHaveBeenCalledOnce();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
