import { hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { err, ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hostPathFromNative, portablePath } from '@core/primitives/desktop-runtime/api';
import {
  registerFileSearchRoot,
  searchFileSearchRoot,
  unregisterFileSearchRoot,
} from './runtime-client';

const mocks = vi.hoisted(() => ({
  release: vi.fn(),
  registerRoot: vi.fn(),
  searchPaths: vi.fn(),
  session: vi.fn(),
  unregisterRoot: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@main/gateway/runtime-broker', () => ({
  getDesktopRuntimeBroker: () => ({ session: mocks.session }),
}));

vi.mock('@main/lib/logger', () => ({
  log: { warn: mocks.warn },
}));

describe('file-search runtime client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockReturnValue({
      ready: async () =>
        ok({
          fileSearch: {
            registerRoot: mocks.registerRoot,
            searchPaths: mocks.searchPaths,
            unregisterRoot: mocks.unregisterRoot,
          },
        }),
      release: mocks.release,
    });
    mocks.registerRoot.mockResolvedValue(ok());
    mocks.unregisterRoot.mockResolvedValue(ok());
    mocks.release.mockResolvedValue(undefined);
  });

  it('registers and unregisters structured workspace roots', async () => {
    const root = hostPathFromNative('/repo');

    await registerFileSearchRoot(root);
    await unregisterFileSearchRoot(root);

    expect(mocks.registerRoot).toHaveBeenCalledWith({ root });
    expect(mocks.unregisterRoot).toHaveBeenCalledWith({ root });
    expect(mocks.session).toHaveBeenCalledTimes(2);
    expect(mocks.session).toHaveBeenNthCalledWith(1, LOCAL_HOST_REF);
    expect(mocks.session).toHaveBeenNthCalledWith(2, LOCAL_HOST_REF);
    expect(mocks.release).toHaveBeenCalledTimes(2);
  });

  it('routes registration through the workspace host session', async () => {
    const root = hostPathFromNative('/repo');
    const remoteHost = hostRef('remote', 'machine-1');

    await registerFileSearchRoot(root, remoteHost);

    expect(mocks.session).toHaveBeenCalledWith(remoteHost);
    expect(mocks.registerRoot).toHaveBeenCalledWith({ root });
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('searches only files and preserves absolute desktop file identities', async () => {
    const root = hostPathFromNative('/repo');
    mocks.searchPaths.mockResolvedValue(
      ok({ hits: [{ path: portablePath('src/index.ts'), kind: 'file' as const }] })
    );

    const client = { searchPaths: mocks.searchPaths } as never;
    await expect(searchFileSearchRoot(client, root, 'index', 500)).resolves.toEqual([
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

    await expect(
      searchFileSearchRoot({ searchPaths: mocks.searchPaths } as never, root, 'index')
    ).resolves.toEqual([]);
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it('logs operational search failures and returns no file hits', async () => {
    const root = hostPathFromNative('/repo');
    mocks.searchPaths.mockResolvedValue(err({ type: 'io', root, message: 'database failed' }));

    await expect(
      searchFileSearchRoot({ searchPaths: mocks.searchPaths } as never, root, 'index')
    ).resolves.toEqual([]);
    expect(mocks.warn).toHaveBeenCalledOnce();
  });
});
