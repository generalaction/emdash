import { ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cloneProjectRepository, initializeProjectRepository } from './repository-setup';

const mocks = vi.hoisted(() => {
  const cloneRepository = vi.fn();
  const commit = vi.fn();
  const exists = vi.fn();
  const fileSystem = vi.fn();
  const getHead = vi.fn();
  const mkdir = vi.fn();
  const openWorktree = vi.fn();
  const publishBranch = vi.fn();
  const releaseRuntime = vi.fn();
  const releaseWorktree = vi.fn();
  const runtimeAcquire = vi.fn();
  const stage = vi.fn();
  const stat = vi.fn();
  const write = vi.fn();

  return {
    cloneRepository,
    commit,
    exists,
    fileSystem,
    getHead,
    mkdir,
    openWorktree,
    publishBranch,
    releaseRuntime,
    releaseWorktree,
    runtimeAcquire,
    stage,
    stat,
    write,
  };
});

vi.mock('@main/core/runtime/runtime-manager', () => ({
  runtimeManager: {
    acquire: mocks.runtimeAcquire,
  },
}));

function makeFilesRuntime() {
  return {
    path: {
      join: (...parts: string[]) => parts.join('/').replace(/\/+/g, '/'),
      dirname: (value: string) => value.slice(0, value.lastIndexOf('/')) || '/',
      basename: (value: string) => value.slice(value.lastIndexOf('/') + 1),
      isAbsolute: (value: string) => value.startsWith('/'),
      relative: (_from: string, to: string) => to,
      contains: () => true,
    },
    fileSystem: mocks.fileSystem.mockImplementation(() =>
      ok({
        exists: mocks.exists,
        mkdir: mocks.mkdir,
        stat: mocks.stat,
        writeText: mocks.write,
      })
    ),
  };
}

describe('cloneProjectRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exists.mockResolvedValue(ok(false));
    mocks.mkdir.mockResolvedValue(ok());
    mocks.runtimeAcquire.mockResolvedValue({
      value: { files: makeFilesRuntime(), git: { cloneRepository: mocks.cloneRepository } },
      release: mocks.releaseRuntime,
    });
  });

  it('creates the local parent directory and clones through the machine git runtime', async () => {
    mocks.cloneRepository.mockResolvedValue({
      success: true,
      data: { kind: 'repository', rootPath: '/work/repo', baseRef: 'main' },
    });

    await expect(
      cloneProjectRepository({
        repositoryUrl: 'https://github.com/acme/repo.git',
        targetPath: '/work/repo',
      })
    ).resolves.toEqual({ success: true });

    expect(mocks.fileSystem).toHaveBeenCalledWith();
    expect(mocks.mkdir).toHaveBeenCalledWith('/work', { recursive: true });
    expect(mocks.runtimeAcquire).toHaveBeenCalledWith({ kind: 'local' });
    expect(mocks.cloneRepository).toHaveBeenCalledWith(
      'https://github.com/acme/repo.git',
      '/work/repo'
    );
    expect(mocks.releaseRuntime).toHaveBeenCalledOnce();
  });

  it('uses the ssh machine runtime for remote clones', async () => {
    mocks.cloneRepository.mockResolvedValue({
      success: true,
      data: { kind: 'repository', rootPath: '/home/jona/repo', baseRef: 'main' },
    });

    await expect(
      cloneProjectRepository({
        repositoryUrl: 'git@github.com:acme/repo.git',
        targetPath: '/home/jona/repo',
        connectionId: 'conn-1',
      })
    ).resolves.toEqual({ success: true });

    expect(mocks.runtimeAcquire).toHaveBeenCalledWith({ kind: 'ssh', connectionId: 'conn-1' });
    expect(mocks.releaseRuntime).toHaveBeenCalledOnce();
  });

  it('maps clone errors into setup failures and still releases the runtime lease', async () => {
    mocks.cloneRepository.mockResolvedValue({
      success: false,
      error: { type: 'target_exists', path: '/work/repo' },
    });

    await expect(
      cloneProjectRepository({
        repositoryUrl: 'https://github.com/acme/repo.git',
        targetPath: '/work/repo',
      })
    ).resolves.toEqual({
      success: false,
      error: 'Target directory already exists and is not empty: /work/repo',
    });
    expect(mocks.releaseRuntime).toHaveBeenCalledOnce();
  });
});

describe('initializeProjectRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stat.mockResolvedValue(ok({ path: '/work/repo', type: 'directory' }));
    mocks.write.mockResolvedValue(ok({ bytesWritten: 20 }));
    mocks.stage.mockResolvedValue({ success: true, data: {} });
    mocks.commit.mockResolvedValue({ success: true, data: { hash: 'abc123', sequences: {} } });
    mocks.getHead.mockResolvedValue({ kind: 'branch', name: 'main', oid: 'abc123' });
    mocks.publishBranch.mockResolvedValue({
      success: true,
      data: { output: '', sequences: {} },
    });
    mocks.openWorktree.mockResolvedValue({
      value: {
        stage: mocks.stage,
        commit: mocks.commit,
        getHead: mocks.getHead,
        repository: { publishBranch: mocks.publishBranch },
      },
      release: mocks.releaseWorktree,
    });
    mocks.runtimeAcquire.mockResolvedValue({
      value: { files: makeFilesRuntime(), git: { openWorktree: mocks.openWorktree } },
      release: mocks.releaseRuntime,
    });
  });

  it('writes the initial README, commits it, and pushes the current branch', async () => {
    await expect(
      initializeProjectRepository({
        targetPath: '/work/repo',
        name: 'Repo',
        description: 'Description',
      })
    ).resolves.toEqual({ success: true });

    expect(mocks.fileSystem).toHaveBeenCalledWith();
    expect(mocks.stat).toHaveBeenCalledWith('/work/repo');
    expect(mocks.write).toHaveBeenCalledWith('/work/repo/README.md', '# Repo\n\nDescription\n');
    expect(mocks.runtimeAcquire).toHaveBeenCalledWith({ kind: 'local' });
    expect(mocks.openWorktree).toHaveBeenCalledWith('/work/repo');
    expect(mocks.stage).toHaveBeenCalledWith(['/work/repo/README.md']);
    expect(mocks.commit).toHaveBeenCalledWith('Initial commit');
    expect(mocks.publishBranch).toHaveBeenCalledWith('main', 'origin');
    expect(mocks.releaseWorktree).toHaveBeenCalledOnce();
    expect(mocks.releaseRuntime).toHaveBeenCalledOnce();
  });

  it('uses the unborn branch name when pushing an initialized repository', async () => {
    mocks.getHead.mockResolvedValue({ kind: 'unborn', name: 'trunk' });

    await expect(
      initializeProjectRepository({
        targetPath: '/work/repo',
        name: 'Repo',
      })
    ).resolves.toEqual({ success: true });

    expect(mocks.write).toHaveBeenCalledWith('/work/repo/README.md', '# Repo\n');
    expect(mocks.publishBranch).toHaveBeenCalledWith('trunk', 'origin');
  });

  it('returns a setup failure when the target path does not exist', async () => {
    mocks.stat.mockResolvedValue({
      success: false,
      error: { type: 'fs-error', path: '/work/repo', message: 'missing', code: 'ENOENT' },
    });

    await expect(
      initializeProjectRepository({
        targetPath: '/work/repo',
        name: 'Repo',
      })
    ).resolves.toEqual({ success: false, error: 'Local path does not exist' });

    expect(mocks.runtimeAcquire).toHaveBeenCalledWith({ kind: 'local' });
    expect(mocks.releaseRuntime).toHaveBeenCalledOnce();
  });

  it('returns a setup failure when the initial commit fails', async () => {
    mocks.commit.mockResolvedValue({
      success: false,
      error: { type: 'empty-commit', message: 'Nothing to commit' },
    });

    await expect(
      initializeProjectRepository({
        targetPath: '/work/repo',
        name: 'Repo',
      })
    ).resolves.toEqual({ success: false, error: 'Nothing to commit' });
    expect(mocks.releaseWorktree).toHaveBeenCalledOnce();
    expect(mocks.releaseRuntime).toHaveBeenCalledOnce();
  });
});
