import path from 'node:path';
import type { GitRefsState } from '@emdash/core/runtimes/git/api';
import { ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkoutSelector, repositorySelector } from '@main/core/git/runtime-process/client';
import type { GitRuntimeClient } from '@main/core/git/runtime-process/host';
import { nativePathFromHost, resolveRelativePath } from '@shared/core/runtime/paths';
import type { ProjectSettingsProvider } from '../settings/provider';
import { WorktreeService } from './worktree-service';

const fileSystem = vi.hoisted(() => ({
  existing: new Set<string>(),
  removed: [] as string[],
}));
const runtime = vi.hoisted(() => ({ runGitJob: vi.fn() }));
const filesRuntime = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock('@main/core/git/runtime-process/client', async (importOriginal) => ({
  ...(await importOriginal()),
  runGitJob: runtime.runGitJob,
}));

vi.mock('@main/core/files/runtime-process/host', () => ({
  getFilesRuntimeClient: async () => filesRuntime.client,
}));

describe('WorktreeService runtime orchestration', () => {
  beforeEach(() => {
    fileSystem.existing.clear();
    fileSystem.removed.length = 0;
    runtime.runGitJob.mockImplementation((_definition, handle, input) => handle(input));
    filesRuntime.client = makeFilesClient();
  });

  it('creates a local branch and worktree from the selected source branch', async () => {
    const git = makeGitRepository({ refs: refs(localBranch('main')) });
    const service = makeService(git.client);

    const result = await service.checkoutBranchWorktree(
      { type: 'local', branch: 'main' },
      'task/feature',
      { copyPreservedFiles: false }
    );

    expect(result).toEqual(ok(path.join('/pool', 'task/feature')));
    expectMutation(git.mutate, 'createBranch', {
      options: { name: 'task/feature', from: 'refs/heads/main' },
    });
    expectMutation(git.mutate, 'setBranchBase', { branch: 'task/feature', base: 'main' });
    expectMutation(git.mutate, 'addWorktree', {
      options: {
        path: hostPath(path.join('/pool', 'task/feature')),
        ref: 'task/feature',
      },
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
    const service = makeService(git.client);

    const result = await service.checkoutBranchWorktree(
      { type: 'local', branch: 'main' },
      'feature',
      { copyPreservedFiles: false }
    );

    expect(result).toEqual(ok('/external/feature'));
    expect(git.mutate).not.toHaveBeenCalledWith('addWorktree', expect.anything());
  });

  it('creates and tracks a local branch from an available remote branch', async () => {
    const git = makeGitRepository({
      refs: refs(remoteBranch('origin', 'feature')),
    });
    const service = makeService(git.client);

    const result = await service.checkoutExistingBranch('feature', {
      copyPreservedFiles: false,
    });

    expect(result).toEqual(ok(path.join('/pool', 'feature')));
    expect(git.fetch).toHaveBeenCalledWith(expect.objectContaining({ remote: 'origin' }));
    expectMutation(git.mutate, 'createBranch', {
      options: { name: 'feature', from: 'origin/feature' },
    });
    expectMutation(git.mutate, 'setUpstream', {
      branch: 'feature',
      upstream: 'origin/feature',
    });
  });

  it('returns branch-not-found without attempting to add a worktree', async () => {
    const git = makeGitRepository();
    const service = makeService(git.client);

    const result = await service.checkoutBranchWorktree(
      { type: 'local', branch: 'missing' },
      'task/missing',
      { copyPreservedFiles: false }
    );

    expect(result).toEqual({
      success: false,
      error: { type: 'branch-not-found', branch: 'missing' },
    });
    expect(git.mutate).not.toHaveBeenCalledWith('createBranch', expect.anything());
    expect(git.mutate).not.toHaveBeenCalledWith('addWorktree', expect.anything());
  });
});

function makeService(git: GitRuntimeClient): WorktreeService {
  return new WorktreeService({
    repoPath: '/repo',
    git,
    files: filesRuntime.client as never,
    repository: repositorySelector('/repo'),
    checkout: checkoutSelector('/repo'),
    projectSettings: {
      getBaseRemote: vi.fn().mockResolvedValue('origin'),
    } as unknown as ProjectSettingsProvider,
    resolveWorktreePoolPath: async () => '/pool',
  });
}

function makeFilesClient() {
  return {
    fs: {
      exists: vi.fn(async (key) => ok(fileSystem.existing.has(path.resolve(keyPath(key))))),
      realPath: vi.fn(async (key) => ok(resolveRelativePath(key.root, key.relative))),
    },
    mutations: {
      createDirectory: vi.fn(async ({ root, path: relative }) => {
        fileSystem.existing.add(path.resolve(keyPath({ root, relative })));
        return ok<void>();
      }),
      delete: vi.fn(async ({ root, path: relative }) => {
        const resolved = path.resolve(keyPath({ root, relative }));
        fileSystem.removed.push(resolved);
        fileSystem.existing.delete(resolved);
        return ok<void>();
      }),
    },
  };
}

function keyPath(key: { root: Parameters<typeof resolveRelativePath>[0]; relative: string }) {
  return nativePathFromHost(resolveRelativePath(key.root, key.relative as never));
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
  const mutate = vi.fn().mockImplementation(async (name: string) =>
    ok({
      data:
        name === 'addWorktree'
          ? { worktreePath: hostPath('/pool/worktree'), head: { kind: 'branch', name: 'feature' } }
          : undefined,
    })
  );
  const fetch = vi.fn().mockResolvedValue(ok());
  const client = {
    repository: {
      model: {
        mutate,
        state: vi.fn((_key, state: string) => ({
          snapshot: async () => ({ data: state === 'refs' ? (options.refs ?? refs()) : {} }),
        })),
      },
      listWorktrees: vi.fn().mockResolvedValue(ok(options.worktrees ?? [])),
      getBranchBase: vi.fn().mockResolvedValue(ok(null)),
      fetch,
    },
    checkout: { isFileTracked: vi.fn().mockResolvedValue(ok(false)) },
  } as unknown as GitRuntimeClient;
  return { client, fetch, mutate };
}

function expectMutation(mutate: ReturnType<typeof vi.fn>, name: string, input: unknown): void {
  expect(mutate).toHaveBeenCalledWith(name, expect.objectContaining({ input }));
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
