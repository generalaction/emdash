import type { HostAbsolutePath, PortableRelativePath } from '@emdash/core/primitives/path/api';
import { ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nativePathFromHost } from '@shared/core/runtime/paths';
import { cloneProjectRepository, initializeProjectRepository } from './repository-setup';

const mocks = vi.hoisted(() => ({
  cloneRepository: vi.fn(),
  commit: vi.fn(),
  ensureAbsoluteDir: vi.fn(),
  ensureRepository: vi.fn(),
  getHead: vi.fn(),
  publishBranch: vi.fn(),
  stage: vi.fn(),
  stat: vi.fn(),
  writeText: vi.fn(),
}));
const clients = vi.hoisted(() => ({ git: undefined as unknown, files: undefined as unknown }));
const runtime = vi.hoisted(() => ({ runGitJob: vi.fn() }));

vi.mock('@main/core/runtime/files-helpers', () => ({
  ensureAbsoluteDir: mocks.ensureAbsoluteDir,
}));

vi.mock('@main/core/files/runtime-process/host', () => ({
  getFilesRuntimeClient: async () => clients.files,
}));

vi.mock('@main/core/git/runtime-process/host', () => ({
  getGitRuntimeClient: async () => clients.git,
}));

vi.mock('@main/core/git/runtime-process/client', async (importOriginal) => ({
  ...(await importOriginal()),
  runGitJob: runtime.runGitJob,
}));

describe('project repository setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clients.git = makeGitClient();
    clients.files = makeFilesClient();
    runtime.runGitJob.mockImplementation((_definition, handle, input) => handle(input));
    mocks.ensureAbsoluteDir.mockResolvedValue(ok());
    mocks.cloneRepository.mockResolvedValue(
      ok({ kind: 'repository', rootPath: '/work/repo', baseRef: 'main' })
    );
    mocks.stat.mockResolvedValue(
      ok({
        path: '/work/repo',
        type: 'directory',
        size: 0,
        mtime: new Date(),
        ctime: new Date(),
        mode: 0,
      })
    );
    mocks.ensureRepository.mockResolvedValue(
      ok({ kind: 'repository', rootPath: '/work/repo', baseRef: 'main' })
    );
    mocks.writeText.mockResolvedValue(ok({ bytesWritten: 20 }));
    mocks.stage.mockResolvedValue(ok());
    mocks.commit.mockResolvedValue(ok({ hash: 'abc123' }));
    mocks.getHead.mockResolvedValue({ kind: 'branch', name: 'main', oid: 'abc123' });
    mocks.publishBranch.mockResolvedValue(ok({ output: '' }));
  });

  it('creates the local parent directory and clones through the Git runtime', async () => {
    await expect(
      cloneProjectRepository({
        repositoryUrl: 'https://github.com/acme/repo.git',
        targetPath: '/work/repo',
      })
    ).resolves.toEqual({ success: true });

    expect(mocks.ensureAbsoluteDir).toHaveBeenCalledWith('/', '/work');
    expect(mocks.cloneRepository).toHaveBeenCalledWith(
      'https://github.com/acme/repo.git',
      '/work/repo'
    );
  });

  it('preserves structured clone failure messages', async () => {
    mocks.cloneRepository.mockResolvedValue({
      success: false,
      error: {
        type: 'target_exists',
        path: '/work/repo',
        message: 'Target directory already exists and is not empty',
      },
    });

    await expect(
      cloneProjectRepository({
        repositoryUrl: 'https://github.com/acme/repo.git',
        targetPath: '/work/repo',
      })
    ).resolves.toEqual({
      success: false,
      error: 'Target directory already exists and is not empty',
    });
  });

  it('rejects remote setup before invoking a local runtime', async () => {
    await expect(
      cloneProjectRepository({
        repositoryUrl: 'git@github.com:acme/repo.git',
        targetPath: '/home/user/repo',
        connectionId: 'connection-1',
      })
    ).resolves.toEqual({
      success: false,
      error: 'Remote projects require the workspace server and are not supported by this build',
    });
    expect(mocks.cloneRepository).not.toHaveBeenCalled();
  });

  it('initializes, writes, commits, and publishes the current branch', async () => {
    await expect(
      initializeProjectRepository({
        targetPath: '/work/repo',
        name: 'Repo',
        description: 'Description',
      })
    ).resolves.toEqual({ success: true });

    expect(mocks.ensureRepository).toHaveBeenCalledWith('/work/repo', true);
    expect(mocks.writeText).toHaveBeenCalledWith('/work/repo/README.md', '# Repo\n\nDescription\n');
    expect(mocks.stage).toHaveBeenCalledWith(['README.md']);
    expect(mocks.commit).toHaveBeenCalledWith('Initial commit');
    expect(mocks.publishBranch).toHaveBeenCalledWith('main', 'origin');
  });

  it('returns a setup failure when the initial commit fails', async () => {
    mocks.commit.mockResolvedValue({
      success: false,
      error: { type: 'nothing_to_commit', message: 'Nothing to commit' },
    });

    await expect(
      initializeProjectRepository({ targetPath: '/work/repo', name: 'Repo' })
    ).resolves.toEqual({ success: false, error: 'Nothing to commit' });
    expect(mocks.publishBranch).not.toHaveBeenCalled();
  });
});

function makeGitClient() {
  const cloneRepository = vi.fn(({ repositoryUrl, targetPath }) =>
    mocks.cloneRepository(repositoryUrl, nativePathFromHost(targetPath))
  );
  const publishBranch = vi.fn(({ branchName, remote }) => mocks.publishBranch(branchName, remote));
  return {
    cloneRepository,
    ensureRepository: ({
      path,
      options,
    }: {
      path: HostAbsolutePath;
      options?: { initIfMissing?: boolean };
    }) => mocks.ensureRepository(nativePathFromHost(path), options?.initIfMissing ?? false),
    repository: { publishBranch },
    checkout: {
      model: {
        state: () => ({ snapshot: async () => ({ data: await mocks.getHead() }) }),
        mutate: async (
          name: string,
          { input }: { input: { paths?: string[]; message?: string } }
        ) => {
          const result =
            name === 'stage'
              ? await mocks.stage(input.paths ?? [])
              : await mocks.commit(input.message ?? '');
          return result.success ? ok({ data: result.data }) : result;
        },
      },
    },
  };
}

function makeFilesClient() {
  return {
    fs: {
      stat: ({ root }: { root: HostAbsolutePath }) => mocks.stat(nativePathFromHost(root)),
    },
    mutations: {
      writeFile: async ({
        root,
        path,
        content,
      }: {
        root: HostAbsolutePath;
        path: PortableRelativePath;
        content: string;
      }) => {
        const result = await mocks.writeText(
          `${nativePathFromHost(root)}/${path}`.replace(/\/+/g, '/'),
          content
        );
        return result.success ? ok(undefined) : result;
      },
    },
  };
}
