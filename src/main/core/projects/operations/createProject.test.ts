import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalProject, createSshProject, getSshProjectPathStatus } from './createProject';

const mocks = vi.hoisted(() => ({
  detectInfoMock: vi.fn(),
  getBranchesMock: vi.fn(),
  getDefaultBranchMock: vi.fn(),
  initRepositoryMock: vi.fn(),
  openProjectMock: vi.fn(),
  getProjectMock: vi.fn(),
  insertMock: vi.fn(),
  valuesMock: vi.fn(),
  returningMock: vi.fn(),
  sshConnectMock: vi.fn(),
  sshStatMock: vi.fn(),
}));

vi.mock('@main/core/git/impl/git-service', () => ({
  GitService: vi.fn(function MockGitService() {
    return {
      detectInfo: mocks.detectInfoMock,
      getBranches: mocks.getBranchesMock,
      getDefaultBranch: mocks.getDefaultBranchMock,
      initRepository: mocks.initRepositoryMock,
    };
  }),
}));

vi.mock('@main/core/fs/impl/ssh-fs', () => ({
  SshFileSystem: vi.fn(function MockSshFileSystem() {
    return {
      stat: mocks.sshStatMock,
    };
  }),
}));

vi.mock('@main/core/ssh/ssh-connection-manager', () => ({
  sshConnectionManager: {
    connect: mocks.sshConnectMock,
  },
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: {
    openProject: mocks.openProjectMock,
    getProject: mocks.getProjectMock,
  },
}));

vi.mock('@main/db/client', () => ({
  db: {
    insert: mocks.insertMock,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();

  mocks.insertMock.mockReturnValue({ values: mocks.valuesMock });
  mocks.valuesMock.mockReturnValue({ returning: mocks.returningMock });
  mocks.openProjectMock.mockResolvedValue(undefined);
  mocks.getProjectMock.mockReturnValue(undefined);
  mocks.getBranchesMock.mockResolvedValue([]);
  mocks.getDefaultBranchMock.mockResolvedValue('main');
  mocks.initRepositoryMock.mockResolvedValue(undefined);
  mocks.sshConnectMock.mockResolvedValue({ id: 'ssh-proxy' });
  mocks.sshStatMock.mockResolvedValue({ path: '', type: 'dir' });
});

describe('createLocalProject', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('initializes git when the selected folder is not yet a repository', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-project-'));
    tempDirs.push(projectPath);
    const row = {
      id: 'project-id',
      name: 'Project',
      path: projectPath,
      baseRef: 'main',
      createdAt: '2026-04-16T00:00:00.000Z',
      updatedAt: '2026-04-16T00:00:00.000Z',
    };

    mocks.detectInfoMock
      .mockResolvedValueOnce({
        isGitRepo: false,
        baseRef: 'main',
        rootPath: projectPath,
      })
      .mockResolvedValueOnce({
        isGitRepo: true,
        baseRef: 'main',
        rootPath: projectPath,
      });
    mocks.returningMock.mockResolvedValue([row]);

    const created = await createLocalProject({
      id: 'project-id',
      name: 'Project',
      path: projectPath,
      initGitRepository: true,
    });

    expect(mocks.initRepositoryMock).toHaveBeenCalledTimes(1);
    expect(mocks.detectInfoMock).toHaveBeenCalledTimes(2);
    expect(created).toMatchObject({
      id: 'project-id',
      name: 'Project',
      path: projectPath,
      baseRef: 'main',
      type: 'local',
    });
    expect(mocks.openProjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'project-id',
        type: 'local',
      })
    );
  });

  it('rejects non-git directories unless initialization is explicitly enabled', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-project-'));
    tempDirs.push(projectPath);

    mocks.detectInfoMock.mockResolvedValue({
      isGitRepo: false,
      baseRef: 'main',
      rootPath: projectPath,
    });

    await expect(
      createLocalProject({
        id: 'project-id',
        name: 'Project',
        path: projectPath,
      })
    ).rejects.toThrow('Directory is not a git repository');

    expect(mocks.initRepositoryMock).not.toHaveBeenCalled();
    expect(mocks.detectInfoMock).toHaveBeenCalledTimes(1);
  });

  it('does not run git init when the folder is already a repository', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-project-'));
    tempDirs.push(projectPath);
    const row = {
      id: 'project-id',
      name: 'Project',
      path: projectPath,
      baseRef: 'origin/main',
      createdAt: '2026-04-16T00:00:00.000Z',
      updatedAt: '2026-04-16T00:00:00.000Z',
    };

    mocks.detectInfoMock.mockResolvedValue({
      isGitRepo: true,
      baseRef: 'origin/main',
      rootPath: projectPath,
    });
    mocks.returningMock.mockResolvedValue([row]);

    await createLocalProject({
      id: 'project-id',
      name: 'Project',
      path: projectPath,
    });

    expect(mocks.initRepositoryMock).not.toHaveBeenCalled();
    expect(mocks.detectInfoMock).toHaveBeenCalledTimes(1);
  });

  it('stores the git remote default branch as baseRef instead of the current feature branch', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-project-'));
    tempDirs.push(projectPath);
    const row = {
      id: 'project-id',
      name: 'Project',
      path: projectPath,
      baseRef: 'origin/main',
      createdAt: '2026-04-16T00:00:00.000Z',
      updatedAt: '2026-04-16T00:00:00.000Z',
    };

    mocks.detectInfoMock.mockResolvedValue({
      isGitRepo: true,
      baseRef: 'origin/feature/current',
      rootPath: projectPath,
    });
    mocks.getDefaultBranchMock.mockResolvedValue('main');
    mocks.getBranchesMock.mockResolvedValue([
      {
        type: 'remote',
        branch: 'main',
        remote: { name: 'origin', url: 'git@github.com:example/repo.git' },
      },
    ]);
    mocks.returningMock.mockResolvedValue([row]);

    const created = await createLocalProject({
      id: 'project-id',
      name: 'Project',
      path: projectPath,
    });

    expect(mocks.valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseRef: 'origin/main' })
    );
    expect(created.baseRef).toBe('origin/main');
  });

  it('keeps the detected baseRef when the git default branch is not present on the remote', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-project-'));
    tempDirs.push(projectPath);
    const row = {
      id: 'project-id',
      name: 'Project',
      path: projectPath,
      baseRef: 'origin/feature/current',
      createdAt: '2026-04-16T00:00:00.000Z',
      updatedAt: '2026-04-16T00:00:00.000Z',
    };

    mocks.detectInfoMock.mockResolvedValue({
      isGitRepo: true,
      baseRef: 'origin/feature/current',
      rootPath: projectPath,
    });
    mocks.getDefaultBranchMock.mockResolvedValue('main');
    mocks.getBranchesMock.mockResolvedValue([
      {
        type: 'remote',
        branch: 'develop',
        remote: { name: 'origin', url: 'git@github.com:example/repo.git' },
      },
    ]);
    mocks.returningMock.mockResolvedValue([row]);

    const created = await createLocalProject({
      id: 'project-id',
      name: 'Project',
      path: projectPath,
    });

    expect(mocks.valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseRef: 'origin/feature/current' })
    );
    expect(created.baseRef).toBe('origin/feature/current');
  });
});

describe('createSshProject', () => {
  const projectPath = '/remote/worktree';
  const row = {
    id: 'project-id',
    name: 'Project',
    path: '/remote/repo-root',
    baseRef: 'main',
    createdAt: '2026-04-16T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z',
    sshConnectionId: 'connection-id',
  };

  it('initializes git when the selected remote folder is not yet a repository', async () => {
    mocks.detectInfoMock
      .mockResolvedValueOnce({
        isGitRepo: false,
        baseRef: 'main',
        rootPath: projectPath,
      })
      .mockResolvedValueOnce({
        isGitRepo: true,
        baseRef: 'main',
        rootPath: row.path,
      });
    mocks.returningMock.mockResolvedValue([row]);

    const created = await createSshProject({
      id: 'project-id',
      name: 'Project',
      path: projectPath,
      connectionId: 'connection-id',
      initGitRepository: true,
    });

    expect(mocks.sshStatMock).toHaveBeenCalledWith('');
    expect(mocks.initRepositoryMock).toHaveBeenCalledTimes(1);
    expect(mocks.detectInfoMock).toHaveBeenCalledTimes(2);
    expect(created).toMatchObject({
      id: 'project-id',
      name: 'Project',
      path: row.path,
      baseRef: 'main',
      type: 'ssh',
      connectionId: 'connection-id',
    });
    expect(mocks.openProjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'project-id',
        type: 'ssh',
      })
    );
  });

  it('rejects non-git remote directories unless initialization is explicitly enabled', async () => {
    mocks.detectInfoMock.mockResolvedValue({
      isGitRepo: false,
      baseRef: 'main',
      rootPath: projectPath,
    });

    await expect(
      createSshProject({
        id: 'project-id',
        name: 'Project',
        path: projectPath,
        connectionId: 'connection-id',
      })
    ).rejects.toThrow('Directory is not a git repository');

    expect(mocks.initRepositoryMock).not.toHaveBeenCalled();
    expect(mocks.detectInfoMock).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid remote directories', async () => {
    mocks.sshStatMock.mockResolvedValueOnce(null);

    await expect(
      createSshProject({
        id: 'project-id',
        name: 'Project',
        path: projectPath,
        connectionId: 'connection-id',
      })
    ).rejects.toThrow('Invalid directory');

    expect(mocks.detectInfoMock).not.toHaveBeenCalled();
    expect(mocks.initRepositoryMock).not.toHaveBeenCalled();
  });

  it('stores the git remote default branch as the SSH project baseRef', async () => {
    const rowWithDefault = {
      ...row,
      baseRef: 'origin/main',
    };

    mocks.detectInfoMock.mockResolvedValue({
      isGitRepo: true,
      baseRef: 'origin/feature/current',
      rootPath: row.path,
    });
    mocks.getDefaultBranchMock.mockResolvedValue('main');
    mocks.getBranchesMock.mockResolvedValue([
      {
        type: 'remote',
        branch: 'main',
        remote: { name: 'origin', url: 'git@github.com:example/repo.git' },
      },
    ]);
    mocks.returningMock.mockResolvedValue([rowWithDefault]);

    const created = await createSshProject({
      id: 'project-id',
      name: 'Project',
      path: projectPath,
      connectionId: 'connection-id',
    });

    expect(mocks.valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseRef: 'origin/main' })
    );
    expect(created.baseRef).toBe('origin/main');
  });
});

describe('getSshProjectPathStatus', () => {
  const projectPath = '/remote/worktree';

  it('returns invalid status when remote directory does not exist', async () => {
    mocks.sshStatMock.mockResolvedValueOnce(null);

    const status = await getSshProjectPathStatus(projectPath, 'connection-id');

    expect(status).toEqual({ isDirectory: false, isGitRepo: false });
    expect(mocks.detectInfoMock).not.toHaveBeenCalled();
  });

  it('returns git status for existing remote directories', async () => {
    mocks.detectInfoMock.mockResolvedValueOnce({
      isGitRepo: true,
      baseRef: 'origin/main',
      rootPath: '/remote/repo-root',
    });

    const status = await getSshProjectPathStatus(projectPath, 'connection-id');

    expect(status).toEqual({ isDirectory: true, isGitRepo: true });
    expect(mocks.detectInfoMock).toHaveBeenCalledTimes(1);
  });
});
