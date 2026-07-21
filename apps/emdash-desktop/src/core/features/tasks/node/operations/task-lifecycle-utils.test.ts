import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { HostAbsolutePath, PortableRelativePath } from '@emdash/core/primitives/path/api';
import { ok } from '@emdash/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hostPathFromNative,
  nativePathFromHost,
  resolveRelativePath,
} from '@core/primitives/desktop-runtime/api';
import type { WorkspaceConfig } from '@core/primitives/workspaces/api';
import {
  deleteWorkspaceIfUnused,
  hasWorktreeGitMarker,
  pathExists,
  removeOwnedLocalWorktreeDirectory,
  removeWorktreeIfUnused,
} from './task-lifecycle-utils';

const mocks = vi.hoisted(() => ({
  deleteWhere: vi.fn(),
  fileSystemFactory: vi.fn(),
  gitRepository: vi.fn(),
  pruneWorktrees: vi.fn(),
  selectLimit: vi.fn(),
  unregisterFileSearchRoot: vi.fn(),
}));
const clients = vi.hoisted(() => ({ git: undefined as unknown, files: undefined as unknown }));

const db = {
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
} as never;
const dependencies = {
  db,
  getFilesRuntimeClient: async () => clients.files as never,
  runtimes: {
    client: async () => ok({ git: clients.git } as never),
  },
  unregisterFileSearchRoot: mocks.unregisterFileSearchRoot,
};

describe('task lifecycle workspace cleanup', () => {
  let tempDir: string;

  beforeEach(async () => {
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
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'emdash-task-cleanup-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('does not remove a project-root workspace when branchName is a current-branch cache', async () => {
    const project = { removeTaskWorktree: vi.fn() };

    await expect(
      removeWorktreeIfUnused(
        db,
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
        db,
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

  it('unregisters file search when deleting the unreferenced workspace row', async () => {
    mocks.selectLimit
      .mockResolvedValueOnce([
        {
          id: 'workspace-1',
          kind: 'worktree',
          type: 'local',
          location: 'local',
          path: '/repo/worktree',
        },
      ])
      .mockResolvedValueOnce([]);

    await deleteWorkspaceIfUnused(dependencies, 'workspace-1', 'task-1');

    expect(mocks.deleteWhere).toHaveBeenCalledOnce();
    expect(mocks.unregisterFileSearchRoot).toHaveBeenCalledWith(
      hostPathFromNative('/repo/worktree')
    );
  });

  it('preserves the file-search root while an archived sibling still references the workspace', async () => {
    mocks.selectLimit
      .mockResolvedValueOnce([{ id: 'workspace-1', kind: 'worktree' }])
      .mockResolvedValueOnce([{ id: 'archived-sibling' }]);

    await deleteWorkspaceIfUnused(dependencies, 'workspace-1', 'task-1');

    expect(mocks.deleteWhere).not.toHaveBeenCalled();
    expect(mocks.unregisterFileSearchRoot).not.toHaveBeenCalled();
  });

  it('removes an owned local worktree directory and prunes stale git worktree entries', async () => {
    const projectPath = path.join(tempDir, 'project');
    const worktreePath = path.join(tempDir, 'task-worktree');
    await mkdir(path.join(worktreePath, '.git'), { recursive: true });
    await mkdir(projectPath, { recursive: true });
    await writeFile(path.join(worktreePath, 'file.txt'), 'content');

    await expect(
      removeOwnedLocalWorktreeDirectory(
        dependencies,
        {
          kind: 'worktree',
          type: 'local',
          location: 'local',
          path: worktreePath,
        },
        projectPath
      )
    ).resolves.toEqual({ success: true, data: true });

    await expect(pathExists(dependencies, worktreePath)).resolves.toBe(false);
    expect(mocks.gitRepository).toHaveBeenCalledWith(projectPath);
    expect(mocks.pruneWorktrees).toHaveBeenCalledOnce();
  });

  it('refuses to remove the project root', async () => {
    const projectPath = path.join(tempDir, 'project');
    await mkdir(projectPath, { recursive: true });

    const removal = await removeOwnedLocalWorktreeDirectory(
      dependencies,
      {
        kind: 'worktree',
        type: 'local',
        location: 'local',
        path: projectPath,
      },
      projectPath
    );

    expect(removal.success).toBe(false);
    if (removal.success) return;
    expect(removal.error.type).toBe('project-root-refused');
    await expect(pathExists(dependencies, projectPath)).resolves.toBe(true);
  });

  it('detects a worktree git marker without shelling out', async () => {
    const worktreePath = path.join(tempDir, 'task-worktree');
    await mkdir(path.join(worktreePath, '.git'), { recursive: true });

    await expect(hasWorktreeGitMarker(dependencies, worktreePath)).resolves.toBe(true);
    expect(mocks.gitRepository).not.toHaveBeenCalled();
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
