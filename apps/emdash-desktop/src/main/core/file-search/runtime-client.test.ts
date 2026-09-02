import { hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { encodeResourceUri, hostFileRef } from '@emdash/core/primitives/path/api';
import { err, ok } from '@emdash/shared';
import { deferred } from '@emdash/shared/testing';
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

  it('shares one status attachment until every acquisition releases it', async () => {
    const runtime = createRuntime();
    const root = hostPathFromNative('/repo');

    await runtime.acquireRoot(root, LOCAL_HOST_REF);
    expect(mocks.state).toHaveBeenCalledWith({ root, exclusions: ['node_modules'] }, 'status');
    expect(mocks.attach).toHaveBeenCalledOnce();
    expect(mocks.client).toHaveBeenCalledWith(LOCAL_HOST_REF);

    // A second interest shares the attachment but owns a separate release.
    await runtime.acquireRoot(root, LOCAL_HOST_REF);
    expect(mocks.attach).toHaveBeenCalledOnce();

    await runtime.releaseRoot(root, LOCAL_HOST_REF);
    expect(mocks.detach).not.toHaveBeenCalled();

    await runtime.releaseRoot(root, LOCAL_HOST_REF);
    expect(mocks.detach).toHaveBeenCalledOnce();

    // An unbalanced extra release is a no-op.
    await runtime.releaseRoot(root, LOCAL_HOST_REF);
    expect(mocks.detach).toHaveBeenCalledOnce();
  });

  it('does not attach when the last interest releases during exclusion resolution', async () => {
    const exclusions = deferred<readonly string[]>();
    mocks.getSearchExclusions.mockReturnValueOnce(exclusions.promise);
    const runtime = createRuntime();
    const root = hostPathFromNative('/repo');

    const acquiring = runtime.acquireRoot(root, LOCAL_HOST_REF);
    await vi.waitFor(() => expect(mocks.getSearchExclusions).toHaveBeenCalledOnce());
    const releasing = runtime.releaseRoot(root, LOCAL_HOST_REF);
    exclusions.resolve(['node_modules']);
    await Promise.all([acquiring, releasing]);

    expect(mocks.attach).not.toHaveBeenCalled();
    expect(mocks.detach).not.toHaveBeenCalled();
  });

  it('coalesces concurrent acquisitions before exclusion resolution', async () => {
    const exclusions = deferred<readonly string[]>();
    mocks.getSearchExclusions.mockReturnValueOnce(exclusions.promise);
    const runtime = createRuntime();
    const root = hostPathFromNative('/repo');

    const first = runtime.acquireRoot(root, LOCAL_HOST_REF);
    const second = runtime.acquireRoot(root, LOCAL_HOST_REF);
    await vi.waitFor(() => expect(mocks.getSearchExclusions).toHaveBeenCalledOnce());
    exclusions.resolve(['node_modules']);
    await Promise.all([first, second]);

    expect(mocks.attach).toHaveBeenCalledOnce();
    await runtime.releaseRoot(root, LOCAL_HOST_REF);
    expect(mocks.detach).not.toHaveBeenCalled();
    await runtime.releaseRoot(root, LOCAL_HOST_REF);
    expect(mocks.detach).toHaveBeenCalledOnce();
  });

  it('does not resurrect a released root while refreshing exclusions', async () => {
    const attached = deferred<typeof mocks.detach>();
    mocks.getSearchExclusions
      .mockResolvedValueOnce(['node_modules'])
      .mockResolvedValueOnce(['dist']);
    mocks.attach.mockReturnValueOnce(attached.promise).mockResolvedValue(mocks.detach);
    const runtime = createRuntime();
    const root = hostPathFromNative('/repo');

    const acquiring = runtime.acquireRoot(root, LOCAL_HOST_REF);
    await vi.waitFor(() => expect(mocks.attach).toHaveBeenCalledOnce());
    const refreshing = runtime.refreshExclusions();
    await vi.waitFor(() => expect(mocks.getSearchExclusions).toHaveBeenCalledTimes(2));
    // Let refresh enter closeLease(), where it waits for the pending attachment.
    await Promise.resolve();
    const releasing = runtime.releaseRoot(root, LOCAL_HOST_REF);

    attached.resolve(mocks.detach);
    await Promise.all([acquiring, refreshing, releasing]);

    expect(mocks.attach).toHaveBeenCalledOnce();
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

  it('keeps the newest policy when exclusion refreshes resolve out of order', async () => {
    const stale = deferred<readonly string[]>();
    const latest = deferred<readonly string[]>();
    const runtime = createRuntime();
    const root = hostPathFromNative('/repo');
    await runtime.acquireRoot(root, LOCAL_HOST_REF);
    mocks.getSearchExclusions
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(latest.promise);

    const first = runtime.refreshExclusions();
    await vi.waitFor(() => expect(mocks.getSearchExclusions).toHaveBeenCalledTimes(2));
    const second = runtime.refreshExclusions();
    await vi.waitFor(() => expect(mocks.getSearchExclusions).toHaveBeenCalledTimes(3));

    latest.resolve(['latest']);
    await second;
    stale.resolve(['stale']);
    await first;

    expect(mocks.attach).toHaveBeenCalledTimes(2);
    expect(mocks.state).toHaveBeenLastCalledWith({ root, exclusions: ['latest'] }, 'status');
  });

  it('keeps refreshed policy when a same-revision acquisition resolves late', async () => {
    const refreshRead = deferred<readonly string[]>();
    const acquisitionRead = deferred<readonly string[]>();
    mocks.getSearchExclusions
      .mockReturnValueOnce(refreshRead.promise)
      .mockReturnValueOnce(acquisitionRead.promise);
    const runtime = createRuntime();
    const root = hostPathFromNative('/repo');

    // Acquisition queues its read; refresh increments the revision and reads first.
    const acquiring = runtime.acquireRoot(root, LOCAL_HOST_REF);
    const refreshing = runtime.refreshExclusions();
    await vi.waitFor(() => expect(mocks.getSearchExclusions).toHaveBeenCalledTimes(2));

    refreshRead.resolve(['new-policy']);
    await Promise.resolve();
    acquisitionRead.resolve(['old-policy']);
    await Promise.all([acquiring, refreshing]);

    expect(mocks.attach).toHaveBeenCalledOnce();
    expect(mocks.state).toHaveBeenLastCalledWith({ root, exclusions: ['new-policy'] }, 'status');
  });

  it('releases the lease before evicting the durable index', async () => {
    const runtime = createRuntime();
    const root = hostPathFromNative('/repo');

    await runtime.acquireRoot(root, LOCAL_HOST_REF);
    await runtime.acquireRoot(root, LOCAL_HOST_REF);
    await runtime.evictRoot(root, LOCAL_HOST_REF);

    expect(mocks.detach).toHaveBeenCalledOnce();
    expect(mocks.evictRoot).toHaveBeenCalledWith({ root });

    await runtime.releaseRoot(root, LOCAL_HOST_REF);
    expect(mocks.detach).toHaveBeenCalledOnce();
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
