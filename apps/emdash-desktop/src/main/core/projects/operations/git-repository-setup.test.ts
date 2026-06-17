import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cloneProjectRepository, initializeProjectRepository } from './git-repository-setup';

const mocks = vi.hoisted(() => {
  const cloneRepository = vi.fn();
  const commit = vi.fn();
  const connect = vi.fn();
  const exists = vi.fn();
  const getHead = vi.fn();
  const mkdir = vi.fn();
  const openWorktree = vi.fn();
  const publishBranch = vi.fn();
  const releaseRuntime = vi.fn();
  const releaseWorktree = vi.fn();
  const runtimeAcquire = vi.fn();
  const stage = vi.fn();
  const write = vi.fn();

  return {
    cloneRepository,
    commit,
    connect,
    exists,
    getHead,
    localFileSystem: vi.fn(function () {
      return { exists, mkdir, write };
    }),
    mkdir,
    openWorktree,
    publishBranch,
    releaseRuntime,
    releaseWorktree,
    runtimeAcquire,
    sshFileSystem: vi.fn(function () {
      return { exists, mkdir, write };
    }),
    stage,
    write,
  };
});

vi.mock('@main/core/fs/impl/local-fs', () => ({
  LocalFileSystem: mocks.localFileSystem,
}));

vi.mock('@main/core/fs/impl/ssh-fs', () => ({
  SshFileSystem: mocks.sshFileSystem,
}));

vi.mock('@main/core/runtime/runtime-manager', () => ({
  runtimeManager: {
    acquire: mocks.runtimeAcquire,
  },
}));

vi.mock('@main/core/ssh/lifecycle/production-ssh-connection-manager', () => ({
  sshConnectionManager: {
    connect: mocks.connect,
  },
}));

describe('cloneProjectRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.runtimeAcquire.mockResolvedValue({
      value: { git: { cloneRepository: mocks.cloneRepository } },
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

    expect(mocks.localFileSystem).toHaveBeenCalledWith('/work');
    expect(mocks.mkdir).toHaveBeenCalledWith('.', { recursive: true });
    expect(mocks.runtimeAcquire).toHaveBeenCalledWith({ kind: 'local' });
    expect(mocks.cloneRepository).toHaveBeenCalledWith(
      'https://github.com/acme/repo.git',
      '/work/repo'
    );
    expect(mocks.releaseRuntime).toHaveBeenCalledOnce();
  });

  it('uses the ssh filesystem and ssh machine runtime for remote clones', async () => {
    const proxy = { connectionId: 'conn-1' };
    mocks.connect.mockResolvedValue(proxy);
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

    expect(mocks.connect).toHaveBeenCalledWith('conn-1');
    expect(mocks.sshFileSystem).toHaveBeenCalledWith(proxy, '/home/jona');
    expect(mocks.runtimeAcquire).toHaveBeenCalledWith({ kind: 'ssh', connectionId: 'conn-1' });
    expect(mocks.releaseRuntime).toHaveBeenCalledOnce();
  });

  it('maps clone errors into setup failures and still releases the runtime lease', async () => {
    mocks.cloneRepository.mockResolvedValue({
      success: false,
      error: { type: 'target-exists', path: '/work/repo' },
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
    mocks.exists.mockResolvedValue(true);
    mocks.write.mockResolvedValue({ success: true, bytesWritten: 20 });
    mocks.stage.mockResolvedValue({});
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
      value: { git: { openWorktree: mocks.openWorktree } },
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

    expect(mocks.localFileSystem).toHaveBeenCalledWith('/work/repo');
    expect(mocks.exists).toHaveBeenCalledWith('.');
    expect(mocks.write).toHaveBeenCalledWith('README.md', '# Repo\n\nDescription\n');
    expect(mocks.runtimeAcquire).toHaveBeenCalledWith({ kind: 'local' });
    expect(mocks.openWorktree).toHaveBeenCalledWith('/work/repo');
    expect(mocks.stage).toHaveBeenCalledWith(['README.md']);
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

    expect(mocks.write).toHaveBeenCalledWith('README.md', '# Repo\n');
    expect(mocks.publishBranch).toHaveBeenCalledWith('trunk', 'origin');
  });

  it('returns a setup failure when the target path does not exist', async () => {
    mocks.exists.mockResolvedValue(false);

    await expect(
      initializeProjectRepository({
        targetPath: '/work/repo',
        name: 'Repo',
      })
    ).resolves.toEqual({ success: false, error: 'Local path does not exist' });

    expect(mocks.runtimeAcquire).not.toHaveBeenCalled();
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
