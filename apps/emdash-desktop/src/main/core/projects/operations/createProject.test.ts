import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HostAbsolutePath, PortableRelativePath } from '@emdash/core/path';
import { ok, type Result } from '@emdash/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hostPathFromNative,
  nativePathFromHost,
  resolveRelativePath,
} from '@shared/core/runtime/paths';
import { createLocalProject, getLocalProjectPathStatus } from './create-local-project';
import { createSshProject, getSshProjectPathStatus } from './create-ssh-project';

const mocks = vi.hoisted(() => ({
  ensureRepositoryMock: vi.fn(),
  inspectPathMock: vi.fn(),
  openRepositoryMock: vi.fn(),
  repoGetDefaultBranchMock: vi.fn(),
  repoGetRefsMock: vi.fn(),
  openProjectMock: vi.fn(),
  getProjectMock: vi.fn(),
  insertMock: vi.fn(),
  valuesMock: vi.fn(),
  returningMock: vi.fn(),
  statMock: vi.fn(),
}));
const clients = vi.hoisted(() => ({ git: undefined as unknown, files: undefined as unknown }));

vi.mock('@main/core/files/runtime-process/host', () => ({
  getFilesRuntimeClient: async () => clients.files,
}));

vi.mock('@main/core/git/runtime-process/host', () => ({
  getGitRuntimeClient: async () => clients.git,
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
  clients.git = makeGitClient();
  clients.files = makeFilesClient();

  mocks.insertMock.mockReturnValue({ values: mocks.valuesMock });
  mocks.valuesMock.mockReturnValue({ returning: mocks.returningMock });
  mocks.openProjectMock.mockResolvedValue(undefined);
  mocks.getProjectMock.mockReturnValue(undefined);
  mocks.ensureRepositoryMock.mockImplementation(async (projectPath: string) => ({
    success: true,
    data: { kind: 'repository', rootPath: projectPath, baseRef: 'main' },
  }));
  mocks.inspectPathMock.mockImplementation(async (projectPath: string) => ({
    kind: 'repository',
    rootPath: projectPath,
    baseRef: 'main',
  }));
  mocks.openRepositoryMock.mockReturnValue({
    getDefaultBranch: mocks.repoGetDefaultBranchMock,
    getRefs: mocks.repoGetRefsMock,
  });
  mocks.repoGetRefsMock.mockResolvedValue({ branches: [] });
  mocks.repoGetDefaultBranchMock.mockResolvedValue(ok('main'));
  mocks.statMock.mockResolvedValue(ok({ path: 'worktree', type: 'directory' }));
});

function makeGitClient() {
  return {
    ensureRepository: async ({
      path: repositoryPath,
      options,
    }: {
      path: HostAbsolutePath;
      options?: { initIfMissing?: boolean };
    }) => {
      const result = await mocks.ensureRepositoryMock(
        nativePathFromHost(repositoryPath),
        options?.initIfMissing ?? false
      );
      return result.success
        ? ok({ ...result.data, rootPath: hostPathFromNative(result.data.rootPath) })
        : { ...result, error: { ...result.error, path: hostPathFromNative(result.error.path) } };
    },
    inspectPath: async ({ path: inspectedPath }: { path: HostAbsolutePath }) => {
      const result = await mocks.inspectPathMock(nativePathFromHost(inspectedPath));
      return result.kind === 'repository'
        ? { ...result, rootPath: hostPathFromNative(result.rootPath) }
        : { ...result, path: hostPathFromNative(result.path) };
    },
    repository: {
      getDefaultBranch: ({
        repository,
        remote,
      }: {
        repository: HostAbsolutePath;
        remote?: string;
      }) => mocks.openRepositoryMock(nativePathFromHost(repository)).getDefaultBranch(remote),
      model: {
        state: (selector: { repository: HostAbsolutePath }) => ({
          snapshot: async () => ({
            data: await mocks.openRepositoryMock(nativePathFromHost(selector.repository)).getRefs(),
          }),
        }),
      },
    },
  };
}

function makeFilesClient() {
  return {
    fs: {
      stat: ({ root, relative }: { root: HostAbsolutePath; relative: PortableRelativePath }) =>
        mocks.statMock(nativePathFromHost(resolveRelativePath(root, relative))),
    },
  };
}

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

    expect(mocks.ensureRepositoryMock).toHaveBeenCalledWith(projectPath, true);
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

    expect(mocks.ensureRepositoryMock).toHaveBeenCalledWith(projectPath, false);
    expect(mocks.openRepositoryMock).not.toHaveBeenCalled();
  });

  it('surfaces git inspection failures when creating a local project', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-project-'));
    tempDirs.push(projectPath);

    mocks.ensureRepositoryMock.mockResolvedValueOnce({
      success: false,
      error: {
        type: 'inspect-failed',
        path: projectPath,
        message: 'Permission denied',
      },
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
        type: 'inspect-failed',
        path: projectPath,
        message: 'Permission denied',
      },
    });

    expect(mocks.ensureRepositoryMock).toHaveBeenCalledWith(projectPath, false);
    expect(mocks.openRepositoryMock).not.toHaveBeenCalled();
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

    expect(mocks.ensureRepositoryMock).toHaveBeenCalledWith(projectPath, false);
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
    mocks.repoGetDefaultBranchMock.mockResolvedValue(ok('main'));
    mocks.repoGetRefsMock.mockResolvedValue({
      branches: [
        {
          type: 'remote',
          branch: 'main',
          remote: { name: 'origin', url: 'git@github.com:example/repo.git' },
          oid: '1111111111111111111111111111111111111111',
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
    mocks.repoGetDefaultBranchMock.mockResolvedValue(ok('main'));
    mocks.repoGetRefsMock.mockResolvedValue({
      branches: [
        {
          type: 'remote',
          branch: 'develop',
          remote: { name: 'origin', url: 'git@github.com:example/repo.git' },
          oid: '1111111111111111111111111111111111111111',
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

describe('getLocalProjectPathStatus', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns git status for existing local directories', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-project-'));
    tempDirs.push(projectPath);
    mocks.inspectPathMock.mockResolvedValueOnce({
      kind: 'repository',
      rootPath: projectPath,
      baseRef: 'origin/main',
    });

    const status = await getLocalProjectPathStatus(projectPath);

    expect(status).toEqual({ isDirectory: true, isGitRepo: true });
    expect(mocks.inspectPathMock).toHaveBeenCalledWith(projectPath);
  });

  it('returns inspection failures separately from non-repository status', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-project-'));
    tempDirs.push(projectPath);
    mocks.inspectPathMock.mockResolvedValueOnce({
      kind: 'inspect-failed',
      path: projectPath,
      message: 'Permission denied',
    });

    const status = await getLocalProjectPathStatus(projectPath);

    expect(status).toEqual({
      isDirectory: true,
      isGitRepo: false,
      error: { type: 'inspect-failed', path: projectPath, message: 'Permission denied' },
    });
    expect(mocks.inspectPathMock).toHaveBeenCalledWith(projectPath);
  });

  it('does not inspect git status for local paths that are not directories', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-project-'));
    tempDirs.push(projectPath);
    mocks.statMock.mockResolvedValueOnce(ok({ path: path.basename(projectPath), type: 'file' }));

    const status = await getLocalProjectPathStatus(projectPath);

    expect(status).toEqual({ isDirectory: false, isGitRepo: false });
    expect(mocks.inspectPathMock).not.toHaveBeenCalled();
  });

  it('returns local stat failures as inspection failures', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-project-'));
    tempDirs.push(projectPath);
    mocks.statMock.mockResolvedValueOnce({
      success: false,
      error: {
        type: 'io',
        path: projectPath,
        message: 'Permission denied',
      },
    });

    const status = await getLocalProjectPathStatus(projectPath);

    expect(status).toEqual({
      isDirectory: false,
      isGitRepo: false,
      error: { type: 'inspect-failed', path: projectPath, message: 'Permission denied' },
    });
    expect(mocks.inspectPathMock).not.toHaveBeenCalled();
  });
});

describe('createSshProject', () => {
  const projectPath = '/remote/worktree';

  it('requires the workspace server', async () => {
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
        type: 'inspect-failed',
        path: projectPath,
        message: 'Remote projects require the workspace server and are not supported by this build',
      },
    });

    expect(mocks.ensureRepositoryMock).not.toHaveBeenCalled();
  });
});

describe('getSshProjectPathStatus', () => {
  const projectPath = '/remote/worktree';

  it('reports the workspace server requirement', async () => {
    const status = await getSshProjectPathStatus(projectPath, 'connection-id');

    expect(status).toEqual({
      isDirectory: false,
      isGitRepo: false,
      error: {
        type: 'inspect-failed',
        path: projectPath,
        message: 'Remote projects require the workspace server and are not supported by this build',
      },
    });
    expect(mocks.inspectPathMock).not.toHaveBeenCalled();
  });
});
