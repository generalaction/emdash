import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceConfig } from '@shared/core/workspaces/workspace-config';
import {
  deleteWorkspaceIfUnused,
  hasWorktreeGitMarker,
  pathExists,
  removeOwnedLocalWorktreeDirectory,
  removeWorktreeIfUnused,
} from './task-lifecycle-utils';

const mocks = vi.hoisted(() => ({
  deleteWhere: vi.fn(),
  execFile: vi.fn(),
  selectLimit: vi.fn(),
  deleteIndex: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: mocks.execFile,
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
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.deleteWhere.mockResolvedValue(undefined);
    mocks.execFile.mockImplementation((_cmd, _args, _options, callback) => {
      callback(null, '', '');
      return {};
    });
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'emdash-task-cleanup-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
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

  it('removes an owned local worktree directory and prunes stale git worktree entries', async () => {
    const projectPath = path.join(tempDir, 'project');
    const worktreePath = path.join(tempDir, 'task-worktree');
    await mkdir(path.join(worktreePath, '.git'), { recursive: true });
    await mkdir(projectPath, { recursive: true });
    await writeFile(path.join(worktreePath, 'file.txt'), 'content');

    await expect(
      removeOwnedLocalWorktreeDirectory(
        {
          kind: 'worktree',
          type: 'local',
          location: 'local',
          path: worktreePath,
        },
        projectPath
      )
    ).resolves.toBe(true);

    await expect(pathExists(worktreePath)).resolves.toBe(false);
    expect(mocks.execFile).toHaveBeenCalledWith(
      'git',
      ['-C', projectPath, 'worktree', 'prune'],
      { timeout: 5_000 },
      expect.any(Function)
    );
  });

  it('refuses to remove the project root', async () => {
    const projectPath = path.join(tempDir, 'project');
    await mkdir(projectPath, { recursive: true });

    await expect(
      removeOwnedLocalWorktreeDirectory(
        {
          kind: 'worktree',
          type: 'local',
          location: 'local',
          path: projectPath,
        },
        projectPath
      )
    ).rejects.toThrow('Refusing to remove project root path');
  });

  it('detects a worktree git marker without shelling out', async () => {
    const worktreePath = path.join(tempDir, 'task-worktree');
    await mkdir(path.join(worktreePath, '.git'), { recursive: true });

    await expect(hasWorktreeGitMarker(worktreePath)).resolves.toBe(true);
    expect(mocks.execFile).not.toHaveBeenCalled();
  });
});
