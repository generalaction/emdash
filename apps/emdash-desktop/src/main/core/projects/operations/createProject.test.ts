import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Result } from '@shared/lib/result';
import { createLocalProject } from './create-local-project';
import { createSshProject, getSshProjectPathStatus } from './create-ssh-project';

const mocks = vi.hoisted(() => ({
  acquireRuntimeMock: vi.fn(),
  ensureRepositoryMock: vi.fn(),
  inspectPathMock: vi.fn(),
  openRepositoryMock: vi.fn(),
  repoGetDefaultBranchMock: vi.fn(),
  repoGetRefsMock: vi.fn(),
  repoReleaseMock: vi.fn(),
  runtimeReleaseMock: vi.fn(),
  openProjectMock: vi.fn(),
  getProjectMock: vi.fn(),
  insertMock: vi.fn(),
  valuesMock: vi.fn(),
  returningMock: vi.fn(),
  sshConnectMock: vi.fn(),
  sshStatMock: vi.fn(),
}));

vi.mock('@main/core/runtime/runtime-manager', () => ({
  runtimeManager: {
    acquire: mocks.acquireRuntimeMock,
  },
}));

vi.mock('@main/core/fs/impl/ssh-fs', () => ({
  SshFileSystem: vi.fn(function MockSshFileSystem() {
    return {
      stat: mocks.sshStatMock,
    };
  }),
}));

vi.mock('@main/core/ssh/lifecycle/production-ssh-connection-manager', () => ({
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

function expectOk<T, E>(result: Result<T, E>): T {
  expect(result.success).toBe(true);
  if (!result.success) throw new Error(`Expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
}

beforeEach(() => {
  vi.clearAllMocks();

  mocks.insertMock.mockReturnValue({ values: mocks.valuesMock });
  mocks.valuesMock.mockReturnValue({ returning: mocks.returningMock });
  mocks.openProjectMock.mockResolvedValue(undefined);
  mocks.getProjectMock.mockReturnValue(undefined);
  mocks.acquireRuntimeMock.mockResolvedValue({
    value: {
      git: {
        ensureRepository: mocks.ensureRepositoryMock,
        inspectPath: mocks.inspectPathMock,
        openRepository: mocks.openRepositoryMock,
      },
    },
    release: mocks.runtimeReleaseMock,
  });
  mocks.ensureRepositoryMock.mockImplementation(async (projectPath: string) => ({
    success: true,
    data: { kind: 'repository', rootPath: projectPath, baseRef: 'main' },
  }));
  mocks.inspectPathMock.mockImplementation(async (projectPath: string) => ({
    kind: 'repository',
    rootPath: projectPath,
    baseRef: 'main',
  }));
  mocks.openRepositoryMock.mockResolvedValue({
    value: {
      getDefaultBranch: mocks.repoGetDefaultBranchMock,
      getRefs: mocks.repoGetRefsMock,
    },
    release: mocks.repoReleaseMock,
  });
  mocks.repoGetRefsMock.mockResolvedValue({ branches: [] });
  mocks.repoGetDefaultBranchMock.mockResolvedValue('main');
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

    mocks.ensureRepositoryMock.mockResolvedValueOnce({
      success: true,
      data: { kind: 'repository', rootPath: projectPath, baseRef: 'main' },
    });
    mocks.returningMock.mockResolvedValue([row]);

    const created = expectOk(
      await createLocalProject({
        id: 'project-id',
        name: 'Project',
        path: projectPath,
        initGitRepository: true,
      })
    );

    expect(mocks.ensureRepositoryMock).toHaveBeenCalledWith(projectPath, {
      initIfMissing: true,
    });
    expect(mocks.openRepositoryMock).toHaveBeenCalledWith(projectPath);
    expect(mocks.repoReleaseMock).toHaveBeenCalledTimes(1);
    expect(mocks.runtimeReleaseMock).toHaveBeenCalledTimes(1);
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

    mocks.ensureRepositoryMock.mockResolvedValueOnce({
      success: false,
      error: { type: 'not-repository', path: projectPath },
    });

    await expect(
      createLocalProject({
        id: 'project-id',
        name: 'Project',
        path: projectPath,
      })
    ).resolves.toEqual({
      success: false,
      error: {
        type: 'not-repository',
        path: projectPath,
      },
    });

    expect(mocks.ensureRepositoryMock).toHaveBeenCalledWith(projectPath, {
      initIfMissing: false,
    });
    expect(mocks.openRepositoryMock).not.toHaveBeenCalled();
    expect(mocks.runtimeReleaseMock).toHaveBeenCalledTimes(1);
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

    mocks.ensureRepositoryMock.mockResolvedValueOnce({
      success: true,
      data: { kind: 'repository', rootPath: projectPath, baseRef: 'origin/main' },
    });
    mocks.returningMock.mockResolvedValue([row]);

    expectOk(
      await createLocalProject({
        id: 'project-id',
        name: 'Project',
        path: projectPath,
      })
    );

    expect(mocks.ensureRepositoryMock).toHaveBeenCalledWith(projectPath, {
      initIfMissing: false,
    });
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

    mocks.ensureRepositoryMock.mockResolvedValueOnce({
      success: true,
      data: { kind: 'repository', rootPath: projectPath, baseRef: 'origin/feature/current' },
    });
    mocks.repoGetDefaultBranchMock.mockResolvedValue('main');
    mocks.repoGetRefsMock.mockResolvedValue({
      branches: [
        {
          type: 'remote',
          branch: 'main',
          remote: { name: 'origin', url: 'git@github.com:example/repo.git' },
        },
      ],
    });
    mocks.returningMock.mockResolvedValue([row]);

    const created = expectOk(
      await createLocalProject({
        id: 'project-id',
        name: 'Project',
        path: projectPath,
      })
    );

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

    mocks.ensureRepositoryMock.mockResolvedValueOnce({
      success: true,
      data: { kind: 'repository', rootPath: projectPath, baseRef: 'origin/feature/current' },
    });
    mocks.repoGetDefaultBranchMock.mockResolvedValue('main');
    mocks.repoGetRefsMock.mockResolvedValue({
      branches: [
        {
          type: 'remote',
          branch: 'develop',
          remote: { name: 'origin', url: 'git@github.com:example/repo.git' },
        },
      ],
    });
    mocks.returningMock.mockResolvedValue([row]);

    const created = expectOk(
      await createLocalProject({
        id: 'project-id',
        name: 'Project',
        path: projectPath,
      })
    );

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
    mocks.ensureRepositoryMock.mockResolvedValueOnce({
      success: true,
      data: { kind: 'repository', rootPath: row.path, baseRef: 'main' },
    });
    mocks.returningMock.mockResolvedValue([row]);

    const created = expectOk(
      await createSshProject({
        id: 'project-id',
        name: 'Project',
        path: projectPath,
        connectionId: 'connection-id',
        initGitRepository: true,
      })
    );

    expect(mocks.sshStatMock).toHaveBeenCalledWith('');
    expect(mocks.acquireRuntimeMock).toHaveBeenCalledWith({
      kind: 'ssh',
      connectionId: 'connection-id',
    });
    expect(mocks.ensureRepositoryMock).toHaveBeenCalledWith(projectPath, {
      initIfMissing: true,
    });
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
    mocks.ensureRepositoryMock.mockResolvedValueOnce({
      success: false,
      error: { type: 'not-repository', path: projectPath },
    });

    await expect(
      createSshProject({
        id: 'project-id',
        name: 'Project',
        path: projectPath,
        connectionId: 'connection-id',
      })
    ).resolves.toEqual({
      success: false,
      error: {
        type: 'not-repository',
        path: projectPath,
      },
    });

    expect(mocks.ensureRepositoryMock).toHaveBeenCalledWith(projectPath, {
      initIfMissing: false,
    });
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
    ).resolves.toEqual({
      success: false,
      error: { type: 'invalid-directory', path: projectPath, message: 'Invalid directory' },
    });

    expect(mocks.ensureRepositoryMock).not.toHaveBeenCalled();
  });

  it('stores the git remote default branch as the SSH project baseRef', async () => {
    const rowWithDefault = {
      ...row,
      baseRef: 'origin/main',
    };

    mocks.ensureRepositoryMock.mockResolvedValueOnce({
      success: true,
      data: { kind: 'repository', rootPath: row.path, baseRef: 'origin/feature/current' },
    });
    mocks.repoGetDefaultBranchMock.mockResolvedValue('main');
    mocks.repoGetRefsMock.mockResolvedValue({
      branches: [
        {
          type: 'remote',
          branch: 'main',
          remote: { name: 'origin', url: 'git@github.com:example/repo.git' },
        },
      ],
    });
    mocks.returningMock.mockResolvedValue([rowWithDefault]);

    const created = expectOk(
      await createSshProject({
        id: 'project-id',
        name: 'Project',
        path: projectPath,
        connectionId: 'connection-id',
      })
    );

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
    expect(mocks.inspectPathMock).not.toHaveBeenCalled();
  });

  it('returns git status for existing remote directories', async () => {
    mocks.inspectPathMock.mockResolvedValueOnce({
      kind: 'repository',
      rootPath: '/remote/repo-root',
      baseRef: 'origin/main',
    });

    const status = await getSshProjectPathStatus(projectPath, 'connection-id');

    expect(status).toEqual({ isDirectory: true, isGitRepo: true });
    expect(mocks.inspectPathMock).toHaveBeenCalledWith(projectPath);
  });
});
