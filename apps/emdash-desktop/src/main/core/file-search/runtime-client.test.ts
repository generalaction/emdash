import { hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { encodeResourceUri, hostFileRef } from '@emdash/core/primitives/path/api';
import { err, ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hostPathFromNative, portablePath } from '@core/primitives/desktop-runtime/api';
import { createFileSearchRuntime, searchFileSearchRoot } from './runtime-client';

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  state: vi.fn(),
  attach: vi.fn(),
  detach: vi.fn(),
  evictRoot: vi.fn(),
  searchPaths: vi.fn(),
  getSearchExclusions: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@main/lib/logger', () => ({
  log: { warn: mocks.warn },
}));

function createRuntime() {
  return createFileSearchRuntime({ client: mocks.client } as never, {
    getSearchExclusions: mocks.getSearchExclusions,
  });
}

describe('file-search runtime client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSearchExclusions.mockResolvedValue(['node_modules']);
    mocks.state.mockImplementation(() => ({ attach: mocks.attach }));
    mocks.attach.mockResolvedValue(mocks.detach);
    mocks.evictRoot.mockResolvedValue(ok());
    mocks.client.mockResolvedValue(
      ok({
        fileSearch: {
          activeRoot: { state: mocks.state },
          evictRoot: mocks.evictRoot,
          searchPaths: mocks.searchPaths,
        },
      })
    );
  });

  it('holds one status attachment per acquired root and detaches on release', async () => {
    const runtime = createRuntime();
    const root = hostPathFromNative('/repo');

    await runtime.acquireRoot(root, LOCAL_HOST_REF);
    expect(mocks.state).toHaveBeenCalledWith({ root, exclusions: ['node_modules'] }, 'status');
    expect(mocks.attach).toHaveBeenCalledOnce();
    expect(mocks.client).toHaveBeenCalledWith(LOCAL_HOST_REF);

    // A second acquire for the same root is a no-op: the attachment is held.
    await runtime.acquireRoot(root, LOCAL_HOST_REF);
    expect(mocks.attach).toHaveBeenCalledOnce();

    await runtime.releaseRoot(root, LOCAL_HOST_REF);
    expect(mocks.detach).toHaveBeenCalledOnce();

    // Releasing again is a no-op.
    await runtime.releaseRoot(root, LOCAL_HOST_REF);
    expect(mocks.detach).toHaveBeenCalledOnce();
  });

  it('routes lease attachments through the workspace host client', async () => {
    const runtime = createRuntime();
    const root = hostPathFromNative('/repo');
    const remoteHost = hostRef('remote', 'machine-1');

    await runtime.acquireRoot(root, remoteHost);
    await runtime.releaseRoot(root, remoteHost);

    expect(mocks.client).toHaveBeenCalledTimes(1);
    expect(mocks.client).toHaveBeenCalledWith(remoteHost);
    expect(mocks.state).toHaveBeenCalledWith({ root, exclusions: ['node_modules'] }, 'status');
    expect(mocks.detach).toHaveBeenCalledOnce();
  });

  it('re-leases under the new policy when refreshed exclusions differ, detach before attach', async () => {
    const runtime = createRuntime();
    const root = hostPathFromNative('/repo');
    mocks.getSearchExclusions
      .mockResolvedValueOnce(['node_modules'])
      .mockResolvedValueOnce(['dist']);

    await runtime.acquireRoot(root, LOCAL_HOST_REF);
    const calls: string[] = [];
    mocks.detach.mockImplementation(() => calls.push('detach'));
    mocks.attach.mockImplementation(async () => {
      calls.push('attach');
      return mocks.detach;
    });

    await runtime.refreshExclusions();

    // Break-before-make so the ordered transport hands the root over.
    expect(calls).toEqual(['detach', 'attach']);
    expect(mocks.state).toHaveBeenNthCalledWith(2, { root, exclusions: ['dist'] }, 'status');
  });

  it('keeps the existing lease when refreshed exclusions are unchanged', async () => {
    const runtime = createRuntime();
    const root = hostPathFromNative('/repo');

    await runtime.acquireRoot(root, LOCAL_HOST_REF);
    await runtime.refreshExclusions();

    expect(mocks.attach).toHaveBeenCalledOnce();
    expect(mocks.detach).not.toHaveBeenCalled();
  });

  it('releases the lease before evicting the durable index', async () => {
    const runtime = createRuntime();
    const root = hostPathFromNative('/repo');

    await runtime.acquireRoot(root, LOCAL_HOST_REF);
    await runtime.evictRoot(root, LOCAL_HOST_REF);

    expect(mocks.detach).toHaveBeenCalledOnce();
    expect(mocks.evictRoot).toHaveBeenCalledWith({ root });
  });

  it('searches only files and preserves canonical identity plus the relative coordinate', async () => {
    const root = hostFileRef(hostRef('remote', 'machine-1'), hostPathFromNative('/repo'));
    const relativePath = portablePath('src/index.ts');
    mocks.searchPaths.mockResolvedValue(
      ok({ hits: [{ path: relativePath, kind: 'file' as const }] })
    );

    const client = { searchPaths: mocks.searchPaths } as never;
    await expect(searchFileSearchRoot(client, root, 'index', 500)).resolves.toEqual([
      {
        resource: encodeResourceUri(
          hostFileRef(root.host, hostPathFromNative('/repo/src/index.ts'))
        ),
        relativePath,
        filename: 'index.ts',
      },
    ]);
    expect(mocks.searchPaths).toHaveBeenCalledWith({
      root: root.path,
      query: 'index',
      kinds: ['file'],
      limit: 200,
    });
  });

  it('quietly omits file hits while a root index is still being built', async () => {
    const root = hostFileRef(LOCAL_HOST_REF, hostPathFromNative('/repo'));
    mocks.searchPaths.mockResolvedValue(
      err({ type: 'index-not-ready', root: root.path, message: 'still building' })
    );

    await expect(
      searchFileSearchRoot({ searchPaths: mocks.searchPaths } as never, root, 'index')
    ).resolves.toEqual([]);
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it('logs operational search failures and returns no file hits', async () => {
    const root = hostFileRef(LOCAL_HOST_REF, hostPathFromNative('/repo'));
    mocks.searchPaths.mockResolvedValue(
      err({ type: 'io', root: root.path, message: 'database failed' })
    );

    await expect(
      searchFileSearchRoot({ searchPaths: mocks.searchPaths } as never, root, 'index')
    ).resolves.toEqual([]);
    expect(mocks.warn).toHaveBeenCalledOnce();
  });
});
