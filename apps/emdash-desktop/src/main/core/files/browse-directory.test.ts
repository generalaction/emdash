import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browseDirectory } from './browse-directory';

const mocks = vi.hoisted(() => ({
  acquireRuntimeMock: vi.fn(),
  runtimeReleaseMock: vi.fn(),
  fileSystemMock: vi.fn(),
  globMock: vi.fn(),
  statMock: vi.fn(),
}));

vi.mock('@main/core/runtime/runtime-manager', () => ({
  runtimeManager: {
    acquire: mocks.acquireRuntimeMock,
  },
}));

function expectOk<T, E>(result: Result<T, E>): T {
  expect(result.success).toBe(true);
  if (!result.success) throw new Error(`Expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
}

function makeFilesRuntime() {
  return {
    path: {
      join: (...parts: string[]) => path.posix.join(...parts),
      dirname: (value: string) => path.posix.dirname(value),
      basename: (value: string) => path.posix.basename(value),
      isAbsolute: (value: string) => path.posix.isAbsolute(value),
      relative: (from: string, to: string) => path.posix.relative(from, to),
      contains: () => true,
    },
    fileSystem: mocks.fileSystemMock.mockImplementation(() =>
      ok({
        glob: mocks.globMock,
        stat: mocks.statMock,
      })
    ),
  };
}

async function* directoryMatches(paths: string[]) {
  for (const entry of paths) yield entry;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.acquireRuntimeMock.mockResolvedValue({
    value: {
      files: makeFilesRuntime(),
      git: {},
    },
    release: mocks.runtimeReleaseMock,
  });
});

describe('browseDirectory', () => {
  it('lists directories through the machine file runtime', async () => {
    const firstModifiedAt = new Date('2026-01-01T00:00:00.000Z');
    const secondModifiedAt = new Date('2026-01-02T00:00:00.000Z');
    const thirdModifiedAt = new Date('2026-01-03T00:00:00.000Z');

    mocks.globMock.mockReturnValueOnce(
      ok(
        directoryMatches([
          '/remote/worktree/package.json',
          '/remote/worktree/src',
          '/remote/worktree/.env',
        ])
      )
    );
    mocks.statMock.mockImplementation(async (filePath: string) => {
      if (filePath === '/remote/worktree/src') {
        return ok({
          path: '/remote/worktree/src',
          type: 'directory',
          size: 128,
          mtime: secondModifiedAt,
          ctime: secondModifiedAt,
          mode: 0o755,
        });
      }
      if (filePath === '/remote/worktree/.env') {
        return ok({
          path: '/remote/worktree/.env',
          type: 'file',
          size: 256,
          mtime: thirdModifiedAt,
          ctime: thirdModifiedAt,
          mode: 0o644,
        });
      }
      return ok({
        path: '/remote/worktree/package.json',
        type: 'file',
        size: 512,
        mtime: firstModifiedAt,
        ctime: firstModifiedAt,
        mode: 0o644,
      });
    });

    const entries = expectOk(
      await browseDirectory({
        type: 'ssh',
        connectionId: 'connection-id',
        path: '/remote/worktree',
      })
    );

    expect(mocks.acquireRuntimeMock).toHaveBeenCalledWith({
      kind: 'ssh',
      connectionId: 'connection-id',
    });
    expect(mocks.fileSystemMock).toHaveBeenCalledWith();
    expect(mocks.globMock).toHaveBeenCalledWith(['*'], { cwd: '/remote/worktree', dot: true });
    expect(mocks.runtimeReleaseMock).toHaveBeenCalledTimes(1);
    expect(entries).toEqual([
      {
        path: '/remote/worktree/src',
        name: 'src',
        type: 'directory',
        size: 128,
        modifiedAt: secondModifiedAt,
      },
      {
        path: '/remote/worktree/.env',
        name: '.env',
        type: 'file',
        size: 256,
        modifiedAt: thirdModifiedAt,
      },
      {
        path: '/remote/worktree/package.json',
        name: 'package.json',
        type: 'file',
        size: 512,
        modifiedAt: firstModifiedAt,
      },
    ]);
  });

  it('skips entries that vanish between glob and stat (not-found)', async () => {
    mocks.globMock.mockReturnValueOnce(
      ok(directoryMatches(['/remote/worktree/gone.txt', '/remote/worktree/here.txt']))
    );
    mocks.statMock.mockImplementation(async (filePath: string) => {
      if (filePath === '/remote/worktree/gone.txt') {
        return err({ type: 'fs-error', path: filePath, message: 'missing', code: 'ENOENT' });
      }
      return ok({
        path: '/remote/worktree/here.txt',
        type: 'file',
        size: 1,
        mtime: new Date('2026-01-01T00:00:00.000Z'),
        ctime: new Date('2026-01-01T00:00:00.000Z'),
        mode: 0o644,
      });
    });

    const entries = expectOk(
      await browseDirectory({ type: 'ssh', connectionId: 'c', path: '/remote/worktree' })
    );
    expect(entries.map((entry) => entry.name)).toEqual(['here.txt']);
  });

  it('surfaces non-not-found stat failures as an error result', async () => {
    mocks.globMock.mockReturnValueOnce(ok(directoryMatches(['/remote/worktree/secret.txt'])));
    mocks.statMock.mockImplementation(async (filePath: string) =>
      err({ type: 'fs-error', path: filePath, message: 'permission denied', code: 'EACCES' })
    );

    const result = await browseDirectory({
      type: 'ssh',
      connectionId: 'c',
      path: '/remote/worktree',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatchObject({
        type: 'filesystem-error',
        message: 'permission denied',
      });
    }
  });
});
