import type { HostAbsolutePath, PortableRelativePath } from '@emdash/core/primitives/path/api';
import { ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nativePathFromHost } from '@shared/core/runtime/paths';
import { initializeProjectRepository } from './repository-setup';

const mocks = vi.hoisted(() => ({
  commit: vi.fn(),
  ensureRepository: vi.fn(),
  getHead: vi.fn(),
  publishBranch: vi.fn(),
  stage: vi.fn(),
  stat: vi.fn(),
  writeText: vi.fn(),
}));
const clients = vi.hoisted(() => ({ git: undefined as unknown, files: undefined as unknown }));
const runtime = vi.hoisted(() => ({ runGitJob: vi.fn() }));

vi.mock('@main/core/wire-workers/accessors', () => ({
  getFilesRuntimeClient: async () => clients.files,
  getGitRuntimeClient: async () => clients.git,
}));

vi.mock('@main/core/git/runtime-client', async (importOriginal) => ({
  ...(await importOriginal()),
  runGitJob: runtime.runGitJob,
}));

describe('project repository setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clients.git = makeGitClient();
    clients.files = makeFilesClient();
    runtime.runGitJob.mockImplementation((_definition, handle, input) => handle(input));
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
  const publishBranch = vi.fn(({ branchName, remote }) => mocks.publishBranch(branchName, remote));
  return {
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
