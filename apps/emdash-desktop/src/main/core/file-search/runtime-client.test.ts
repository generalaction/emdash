import { err, ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hostPathFromNative, portablePath } from '@shared/core/runtime/paths';
import {
  registerFileSearchRoot,
  searchFileSearchRoot,
  unregisterFileSearchRoot,
} from './runtime-client';

const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
  registerRoot: vi.fn(),
  searchPaths: vi.fn(),
  unregisterRoot: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@main/core/wire-workers/accessors', () => ({
  getFileSearchRuntimeClient: mocks.getClient,
}));

vi.mock('@main/lib/logger', () => ({
  log: { warn: mocks.warn },
}));

describe('file-search runtime client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClient.mockResolvedValue({
      registerRoot: mocks.registerRoot,
      searchPaths: mocks.searchPaths,
      unregisterRoot: mocks.unregisterRoot,
    });
    mocks.registerRoot.mockResolvedValue(ok());
    mocks.unregisterRoot.mockResolvedValue(ok());
  });

  it('registers and unregisters structured workspace roots', async () => {
    const root = hostPathFromNative('/repo');

    await registerFileSearchRoot(root);
    await unregisterFileSearchRoot(root);

    expect(mocks.registerRoot).toHaveBeenCalledWith({ root });
    expect(mocks.unregisterRoot).toHaveBeenCalledWith({ root });
  });

  it('searches only files and preserves absolute desktop file identities', async () => {
    const root = hostPathFromNative('/repo');
    mocks.searchPaths.mockResolvedValue(
      ok({ hits: [{ path: portablePath('src/index.ts'), kind: 'file' as const }] })
    );

    await expect(searchFileSearchRoot(root, 'index', 500)).resolves.toEqual([
      { path: '/repo/src/index.ts', filename: 'index.ts' },
    ]);
    expect(mocks.searchPaths).toHaveBeenCalledWith({
      root,
      query: 'index',
      kinds: ['file'],
      limit: 200,
    });
  });

  it('quietly omits file hits while a root index is still being built', async () => {
    const root = hostPathFromNative('/repo');
    mocks.searchPaths.mockResolvedValue(
      err({ type: 'index-not-ready', root, message: 'still building' })
    );

    await expect(searchFileSearchRoot(root, 'index')).resolves.toEqual([]);
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it('logs operational search failures and returns no file hits', async () => {
    const root = hostPathFromNative('/repo');
    mocks.searchPaths.mockResolvedValue(err({ type: 'io', root, message: 'database failed' }));

    await expect(searchFileSearchRoot(root, 'index')).resolves.toEqual([]);
    expect(mocks.warn).toHaveBeenCalledOnce();
  });
});
