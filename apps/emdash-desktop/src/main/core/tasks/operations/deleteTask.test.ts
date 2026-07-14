import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { HostAbsolutePath, PortableRelativePath } from '@emdash/core/primitives/path/api';
import { ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nativePathFromHost, resolveRelativePath } from '@shared/core/runtime/paths';
import { deleteTask } from './deleteTask';

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  deleteWhere: vi.fn(),
  delViewState: vi.fn(),
  fileSystemFactory: vi.fn(),
  forceRemoveTask: vi.fn(),
  gitRepository: vi.fn(),
  pruneWorktrees: vi.fn(),
  getProject: vi.fn(),
  getProjectById: vi.fn(),
  selectLimit: vi.fn(),
  teardownTask: vi.fn(),
  unregisterFileSearchRoot: vi.fn(),
}));
const clients = vi.hoisted(() => ({ git: undefined as unknown, files: undefined as unknown }));

vi.mock('@main/core/wire-workers/accessors', () => ({
  getFilesRuntimeClient: async () => clients.files,
  getGitRuntimeClient: async () => clients.git,
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
    forceRemoveTask: mocks.forceRemoveTask,
    teardownTask: mocks.teardownTask,
  },
}));

vi.mock('@main/core/view-state/view-state-service', () => ({
  viewStateService: {
    del: mocks.delViewState,
  },
}));

vi.mock('@main/core/file-search/runtime-client', () => ({
  unregisterFileSearchRoot: mocks.unregisterFileSearchRoot,
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: {
    capture: mocks.capture,
  },
}));

describe('deleteTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clients.files = makeFilesClient();
    clients.git = makeGitClient();
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

  it('force-removes retained lifecycle ownership when teardown fails and delete continues', async () => {
    mocks.getProject.mockReturnValue({});
    mocks.teardownTask.mockResolvedValue({
      success: false,
      error: { message: 'teardown failed' },
    });
    mocks.selectLimit.mockResolvedValueOnce([{ id: 'task-1', workspaceId: null }]);

    await deleteTask('project-1', 'task-1');

    expect(mocks.forceRemoveTask).toHaveBeenCalledWith(
      'task-1',
      'deleteTask continued after teardown failure'
    );
    expect(mocks.deleteWhere).toHaveBeenCalledOnce();
  });

  it('preserves file-search registration when an archived sibling references the workspace', async () => {
    mocks.selectLimit
      .mockResolvedValueOnce([{ id: 'task-1', workspaceId: 'workspace-1' }])
      .mockResolvedValueOnce([
        { id: 'workspace-1', kind: 'worktree', branchName: null, config: null },
      ])
      .mockResolvedValueOnce([{ id: 'workspace-1', kind: 'worktree' }])
      .mockResolvedValueOnce([{ id: 'archived-sibling' }]);

    await deleteTask('project-1', 'task-1', { deleteWorktree: false });

    expect(mocks.unregisterFileSearchRoot).not.toHaveBeenCalled();
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

function makeFilesClient() {
  return {
    fs: {
      exists: ({ root, relative }: { root: HostAbsolutePath; relative: PortableRelativePath }) => {
        const rootPath = nativePathFromHost(root);
        const targetPath = nativePathFromHost(resolveRelativePath(root, relative));
        return mocks.fileSystemFactory(rootPath).exists(targetPath);
      },
    },
    mutations: {
      delete: ({
        root,
        path: relative,
      }: {
        root: HostAbsolutePath;
        path: PortableRelativePath;
      }) => {
        const rootPath = nativePathFromHost(root);
        const targetPath = nativePathFromHost(resolveRelativePath(root, relative));
        return mocks.fileSystemFactory(rootPath).remove(targetPath);
      },
    },
  };
}

function makeGitClient() {
  return {
    repository: {
      model: {
        mutate: async (_name: string, { key }: { key: { repository: HostAbsolutePath } }) => {
          const repositoryPath = nativePathFromHost(key.repository);
          const result = await mocks.gitRepository(repositoryPath).pruneWorktrees();
          return result.success ? ok({ data: result.data }) : result;
        },
      },
    },
  };
}
