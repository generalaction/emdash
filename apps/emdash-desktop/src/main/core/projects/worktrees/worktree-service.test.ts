import path from 'node:path';
import type { GitRefsState } from '@emdash/core/git';
import { ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeGitCheckout, RuntimeGitRepository } from '@main/core/git/runtime-git';
import type { ProjectSettingsProvider } from '../settings/provider';
import { WorktreeService } from './worktree-service';

const fileSystem = vi.hoisted(() => ({
  existing: new Set<string>(),
  removed: [] as string[],
}));

vi.mock('@main/core/files/runtime-files', () => ({
  RuntimeFileSystem: class {
    async exists(targetPath: string) {
      return ok(fileSystem.existing.has(path.resolve(targetPath)));
    }

    async mkdir(targetPath: string) {
      fileSystem.existing.add(path.resolve(targetPath));
      return ok<void>();
    }

    async realPath(targetPath: string) {
      return ok(path.resolve(targetPath));
    }

    async remove(targetPath: string) {
      const resolved = path.resolve(targetPath);
      fileSystem.removed.push(resolved);
      fileSystem.existing.delete(resolved);
      return ok<void>();
    }
  },
}));

describe('WorktreeService runtime orchestration', () => {
  beforeEach(() => {
    fileSystem.existing.clear();
    fileSystem.removed.length = 0;
  });

  it('creates a local branch and worktree from the selected source branch', async () => {
    const git = makeGitRepository({ refs: refs(localBranch('main')) });
    const service = makeService(git.repository);

    const result = await service.checkoutBranchWorktree(
      { type: 'local', branch: 'main' },
      'task/feature',
      { copyPreservedFiles: false }
    );

    expect(result).toEqual(ok(path.join('/pool', 'task/feature')));
    expect(git.repository.createBranch).toHaveBeenCalledWith({
      name: 'task/feature',
      from: 'refs/heads/main',
    });
    expect(git.repository.setBranchBase).toHaveBeenCalledWith('task/feature', 'main');
    expect(git.repository.addWorktree).toHaveBeenCalledWith({
      path: path.join('/pool', 'task/feature'),
      ref: 'task/feature',
    });
  });

  it('reuses a branch that is already checked out outside the managed pool', async () => {
    const git = makeGitRepository({
      worktrees: [
        {
          worktreePath: hostPath('/external/feature'),
          head: { kind: 'branch', name: 'feature' },
        },
      ],
    });
    const service = makeService(git.repository);

    const result = await service.checkoutBranchWorktree(
      { type: 'local', branch: 'main' },
      'feature',
      { copyPreservedFiles: false }
    );

    expect(result).toEqual(ok('/external/feature'));
    expect(git.repository.addWorktree).not.toHaveBeenCalled();
  });

  it('creates and tracks a local branch from an available remote branch', async () => {
    const git = makeGitRepository({
      refs: refs(remoteBranch('origin', 'feature')),
    });
    const service = makeService(git.repository);

    const result = await service.checkoutExistingBranch('feature', {
      copyPreservedFiles: false,
    });

    expect(result).toEqual(ok(path.join('/pool', 'feature')));
    expect(git.repository.fetch).toHaveBeenCalledWith('origin');
    expect(git.repository.createBranch).toHaveBeenCalledWith({
      name: 'feature',
      from: 'origin/feature',
    });
    expect(git.repository.setUpstream).toHaveBeenCalledWith('feature', 'origin/feature');
  });

  it('returns branch-not-found without attempting to add a worktree', async () => {
    const git = makeGitRepository();
    const service = makeService(git.repository);

    const result = await service.checkoutBranchWorktree(
      { type: 'local', branch: 'missing' },
      'task/missing',
      { copyPreservedFiles: false }
    );

    expect(result).toEqual({
      success: false,
      error: { type: 'branch-not-found', branch: 'missing' },
    });
    expect(git.repository.createBranch).not.toHaveBeenCalled();
    expect(git.repository.addWorktree).not.toHaveBeenCalled();
  });
});

function makeService(repository: RuntimeGitRepository): WorktreeService {
  return new WorktreeService({
    repoPath: '/repo',
    gitRepository: repository,
    gitCheckout: {
      isFileTracked: vi.fn().mockResolvedValue(ok(false)),
    } as unknown as RuntimeGitCheckout,
    projectSettings: {
      getBaseRemote: vi.fn().mockResolvedValue('origin'),
    } as unknown as ProjectSettingsProvider,
    resolveWorktreePoolPath: async () => '/pool',
  });
}

function makeGitRepository(
  options: {
    refs?: GitRefsState;
    worktrees?: Array<{
      worktreePath: ReturnType<typeof hostPath>;
      head: { kind: 'branch'; name: string };
    }>;
  } = {}
) {
  const repository = {
    pruneWorktrees: vi.fn().mockResolvedValue(ok()),
    listWorktrees: vi.fn().mockResolvedValue(ok(options.worktrees ?? [])),
    getRefs: vi.fn().mockResolvedValue(options.refs ?? refs()),
    fetch: vi.fn().mockResolvedValue(ok()),
    createBranch: vi.fn().mockResolvedValue(ok()),
    getBranchBase: vi.fn().mockResolvedValue(ok(null)),
    setBranchBase: vi.fn().mockResolvedValue(ok()),
    setUpstream: vi.fn().mockResolvedValue(ok()),
    addWorktree: vi.fn().mockResolvedValue(ok()),
    removeWorktree: vi.fn().mockResolvedValue(ok()),
    moveWorktree: vi.fn().mockResolvedValue(ok()),
  } as unknown as RuntimeGitRepository;
  return { repository };
}

function refs(...branches: GitRefsState['branches']): GitRefsState {
  return { branches, tags: [] };
}

function localBranch(branch: string): GitRefsState['branches'][number] {
  return {
    type: 'local',
    branch,
    oid: '1'.repeat(40),
    divergence: { ahead: 0, behind: 0 },
  };
}

function remoteBranch(remote: string, branch: string): GitRefsState['branches'][number] {
  return {
    type: 'remote',
    remote: { name: remote, url: 'https://example.com/repo.git' },
    branch,
    oid: '2'.repeat(40),
  };
}

function hostPath(value: string) {
  return {
    root: { kind: 'posix' as const },
    segments: value.split('/').filter(Boolean),
  } as const;
}
