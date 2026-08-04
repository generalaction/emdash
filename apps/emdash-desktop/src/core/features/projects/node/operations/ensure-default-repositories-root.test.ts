import path from 'node:path';
import { hostRef } from '@emdash/core/primitives/host/api';
import { err, ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import { hostPathFromNative, nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import { ensureDefaultRepositoriesRoot } from './ensure-default-repositories-root';

const remoteHost = hostRef('remote', 'ssh-1');
const repositoriesRoot = '/home/devuser/emdash/repositories';

function makeHarness(existingPaths: string[]) {
  const existing = new Set(['/', '/home', ...existingPaths]);
  const exists = vi.fn(async ({ root, relative }) => {
    const parent = nativePathFromHost(root);
    if (!existing.has(parent)) return err({ type: 'not-found' as const, path: relative });
    const candidate = relative ? path.posix.join(parent, relative) : parent;
    return ok(existing.has(candidate));
  });
  const createDirectory = vi.fn(async ({ root, path: relative }) => {
    const parent = nativePathFromHost(root);
    const candidate = path.posix.join(parent, relative);
    if (!existing.has(parent)) return err({ type: 'not-found' as const, path: relative });
    if (existing.has(candidate)) return err({ type: 'already-exists' as const, path: relative });
    existing.add(candidate);
    return ok();
  });
  const placement = {
    resolveRepositoriesRoot: vi.fn(async () => ok(repositoriesRoot)),
  };
  const runtimes = {
    client: vi.fn(async () =>
      ok({
        files: {
          fs: { exists },
          mutations: { createDirectory },
        },
      })
    ),
  };

  return {
    dependencies: { placement, runtimes } as never,
    exists,
    createDirectory,
  };
}

describe('ensureDefaultRepositoriesRoot', () => {
  it('returns an existing repositories root without creating directories', async () => {
    const { dependencies, createDirectory } = makeHarness([
      '/home/devuser',
      '/home/devuser/emdash',
      repositoriesRoot,
    ]);

    await expect(ensureDefaultRepositoriesRoot(dependencies, remoteHost)).resolves.toEqual({
      success: true,
      data: repositoriesRoot,
    });
    expect(createDirectory).not.toHaveBeenCalled();
  });

  it('creates one missing repositories-root level', async () => {
    const { dependencies, createDirectory } = makeHarness([
      '/home/devuser',
      '/home/devuser/emdash',
    ]);

    await expect(ensureDefaultRepositoriesRoot(dependencies, remoteHost)).resolves.toEqual({
      success: true,
      data: repositoriesRoot,
    });
    expect(createDirectory).toHaveBeenCalledOnce();
    expect(createDirectory).toHaveBeenCalledWith({
      root: hostPathFromNative('/home/devuser/emdash'),
      path: 'repositories',
    });
  });

  it('creates two missing levels from the nearest existing ancestor', async () => {
    const { dependencies, createDirectory } = makeHarness(['/home/devuser']);

    await expect(ensureDefaultRepositoriesRoot(dependencies, remoteHost)).resolves.toEqual({
      success: true,
      data: repositoriesRoot,
    });
    expect(createDirectory.mock.calls).toEqual([
      [
        {
          root: hostPathFromNative('/home/devuser'),
          path: 'emdash',
        },
      ],
      [
        {
          root: hostPathFromNative('/home/devuser/emdash'),
          path: 'repositories',
        },
      ],
    ]);
  });
});
