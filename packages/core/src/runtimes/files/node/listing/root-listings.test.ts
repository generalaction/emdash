import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ok, type PendingLease } from '@emdash/shared';
import { deferred } from '@emdash/shared/testing';
import { peek, revisionOf } from '@emdash/wire/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostAbsolutePath } from '#primitives/path/api';
import type { FolderListing } from '#runtimes/files/api';
import { resolveRootIdentity } from '#runtimes/files/node/allocation/identity';
import { RootResource } from '#runtimes/files/node/root/root-resource';
import { relativePath, runtimeRoot } from '#runtimes/files/node/testing/paths';
import type { IWatchService, WatchEvent, WatchOptions } from '#services/fs-watch/api';
import { ListingReader } from './listing-reader';
import { RootListings, type RootListingsOptions } from './root-listings';

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});

describe('RootListings', () => {
  it('reads a folder on first subscription and shares it between subscribers', async () => {
    const { rootPath, listings } = await createHarness();
    await writeFile(path.join(rootPath, 'a.ts'), '');
    const readFolder = vi.spyOn(ListingReader.prototype, 'readFolder');

    const first = await acquire(listings, '');
    const second = await acquire(listings, '');

    expect(first.state).toBe(second.state);
    expect(names(peek(first.state))).toEqual(['a.ts']);
    expect(readFolder).toHaveBeenCalledTimes(1);
  });

  it('keeps a released folder for the linger period, then drops it', async () => {
    const { rootPath, listings } = await createHarness({ lingerMs: 20 });
    await mkdir(path.join(rootPath, 'src'));
    const readFolder = vi.spyOn(ListingReader.prototype, 'readFolder');

    const lease = listings.acquire(relativePath('src'));
    const { state } = await lease.ready();
    await lease.release();
    const reopened = listings.acquire(relativePath('src'));
    expect((await reopened.ready()).state).toBe(state);
    expect(readFolder).toHaveBeenCalledTimes(1);
    await reopened.release();

    await new Promise((resolve) => setTimeout(resolve, 60));
    await acquire(listings, 'src');
    expect(readFolder).toHaveBeenCalledTimes(2);
  });

  it('drops the oldest lingering folders early once they hold too many entries', async () => {
    const { rootPath, listings } = await createHarness({ maxLingeringEntries: 2 });
    for (const folder of ['one', 'two']) {
      await mkdir(path.join(rootPath, folder));
      await writeFile(path.join(rootPath, folder, 'a.ts'), '');
      await writeFile(path.join(rootPath, folder, 'b.ts'), '');
    }
    const readFolder = vi.spyOn(ListingReader.prototype, 'readFolder');
    for (const folder of ['one', 'two']) {
      const lease = listings.acquire(relativePath(folder));
      await lease.ready();
      await lease.release();
    }

    await acquire(listings, 'two');
    await acquire(listings, 'one');
    expect(readFolder.mock.calls.map(([folder]) => folder)).toEqual(['one', 'two', 'one']);
  });

  it('applies a changed child with one stat instead of rereading the folder', async () => {
    const { rootPath, listings, watcher } = await createHarness();
    await writeFile(path.join(rootPath, 'kept.ts'), '');
    await writeFile(path.join(rootPath, 'gone.ts'), '');
    const { state } = await acquire(listings, '');
    const readFolder = vi.spyOn(ListingReader.prototype, 'readFolder');
    const readEntry = vi.spyOn(ListingReader.prototype, 'readEntry');
    const kept = entries(peek(state))['kept.ts'];

    await rm(path.join(rootPath, 'gone.ts'));
    await writeFile(path.join(rootPath, 'new.ts'), '');
    watcher.emit([
      { kind: 'delete', path: path.join(rootPath, 'gone.ts') },
      { kind: 'create', path: path.join(rootPath, 'new.ts') },
    ]);

    await vi.waitFor(() => expect(names(peek(state))).toEqual(['kept.ts', 'new.ts']));
    expect(readFolder).not.toHaveBeenCalled();
    expect(readEntry).toHaveBeenCalledTimes(2);
    expect(entries(peek(state))['kept.ts']).toBe(kept);
  });

  it('does not publish when a file only changed its content', async () => {
    const { rootPath, listings, watcher } = await createHarness();
    await writeFile(path.join(rootPath, 'notes.md'), 'one');
    const { state } = await acquire(listings, '');
    const before = revisionOf(state);
    const readEntry = vi.spyOn(ListingReader.prototype, 'readEntry');

    await writeFile(path.join(rootPath, 'notes.md'), 'two, longer');
    watcher.emit([{ kind: 'update', path: path.join(rootPath, 'notes.md') }]);

    await vi.waitFor(() => expect(readEntry).toHaveBeenCalledOnce());
    await listings.applyAbsoluteChanges([]);
    expect(revisionOf(state)).toEqual(before);
  });

  it('rereads the folder when many children change at once', async () => {
    const { rootPath, listings, watcher } = await createHarness();
    const { state } = await acquire(listings, '');
    const readFolder = vi.spyOn(ListingReader.prototype, 'readFolder');
    const readEntry = vi.spyOn(ListingReader.prototype, 'readEntry');
    const created = Array.from({ length: 100 }, (_, index) => `file-${index}.ts`);
    await Promise.all(created.map((name) => writeFile(path.join(rootPath, name), '')));

    watcher.emit(created.map((name) => ({ kind: 'create', path: path.join(rootPath, name) })));

    await vi.waitFor(() => expect(names(peek(state))).toHaveLength(100));
    expect(readFolder).toHaveBeenCalledOnce();
    expect(readEntry.mock.calls.filter(([, canonical]) => canonical === undefined)).toEqual([]);
  });

  it('shares one stat between an ack-time change and the matching watcher event', async () => {
    const { rootPath, listings, root } = await createHarness();
    const { state } = await acquire(listings, '');
    const readEntry = vi.spyOn(ListingReader.prototype, 'readEntry');

    await writeFile(path.join(rootPath, 'made.ts'), '');
    root.publishKnownChanges([{ kind: 'create', path: relativePath('made.ts') }]);
    await listings.applyAbsoluteChanges([
      { kind: 'create', absolutePath: path.join(rootPath, 'made.ts') },
    ]);

    expect(names(peek(state))).toEqual(['made.ts']);
    expect(readEntry).toHaveBeenCalledOnce();
  });

  it('never lets an older read overwrite a newer change', async () => {
    const { rootPath, listings, watcher } = await createHarness();
    const { state, refresh } = await acquire(listings, '');
    const original = ListingReader.prototype.readFolder;
    const release = deferred<void>();
    vi.spyOn(ListingReader.prototype, 'readFolder').mockImplementationOnce(
      async function (this: ListingReader, folder) {
        const read = await original.call(this, folder);
        await release.promise;
        return read;
      }
    );

    const refreshing = refresh();
    await vi.waitFor(() => expect(ListingReader.prototype.readFolder).toHaveBeenCalled());
    await writeFile(path.join(rootPath, 'late.ts'), '');
    watcher.emit([{ kind: 'create', path: path.join(rootPath, 'late.ts') }]);
    release.resolve();
    await refreshing;

    await vi.waitFor(() => expect(names(peek(state))).toEqual(['late.ts']));
  });

  it('turns a listed folder into an error when it disappears and recovers when it returns', async () => {
    const { rootPath, listings, watcher } = await createHarness();
    await mkdir(path.join(rootPath, 'src'));
    await writeFile(path.join(rootPath, 'src/a.ts'), '');
    await acquire(listings, '');
    const { state } = await acquire(listings, 'src');

    await rm(path.join(rootPath, 'src'), { recursive: true });
    watcher.emit([{ kind: 'delete', path: path.join(rootPath, 'src') }]);
    await vi.waitFor(() =>
      expect(peek(state)).toMatchObject({ status: 'error', error: { type: 'not-found' } })
    );

    await mkdir(path.join(rootPath, 'src'));
    await writeFile(path.join(rootPath, 'src/b.ts'), '');
    watcher.emit([{ kind: 'create', path: path.join(rootPath, 'src') }]);
    await vi.waitFor(() => expect(names(peek(state))).toEqual(['b.ts']));
  });

  it('rereads a listed child folder whose entry changes kind', async () => {
    const { rootPath, listings, watcher } = await createHarness();
    await mkdir(path.join(rootPath, 'src'));
    await acquire(listings, '');
    const { state } = await acquire(listings, 'src');

    await rm(path.join(rootPath, 'src'), { recursive: true });
    await writeFile(path.join(rootPath, 'src'), 'now a file');
    watcher.emit([{ kind: 'update', path: path.join(rootPath, 'src') }]);

    await vi.waitFor(() =>
      expect(peek(state)).toMatchObject({ status: 'error', error: { type: 'not-a-directory' } })
    );
  });

  it('rereads every listed folder on a watcher resync, keeping unchanged entries', async () => {
    const { rootPath, listings, watcher } = await createHarness();
    await mkdir(path.join(rootPath, 'src'));
    await writeFile(path.join(rootPath, 'README.md'), '');
    const top = await acquire(listings, '');
    const src = await acquire(listings, 'src');
    const readme = entries(peek(top.state))['README.md'];

    await writeFile(path.join(rootPath, 'src/new.ts'), '');
    watcher.resync();

    await vi.waitFor(() => expect(names(peek(src.state))).toEqual(['new.ts']));
    expect(entries(peek(top.state))['README.md']).toBe(readme);
  });

  it('refreshes a folder together with the listed folders beneath it', async () => {
    const { rootPath, listings } = await createHarness();
    await mkdir(path.join(rootPath, 'src/deep'), { recursive: true });
    const src = await acquire(listings, 'src');
    const deep = await acquire(listings, 'src/deep');
    await writeFile(path.join(rootPath, 'src/deep/unseen.ts'), '');

    await src.refresh();

    expect(names(peek(deep.state))).toEqual(['unseen.ts']);
  });

  it('watches the children of a listed folder that the root watch ignores', async () => {
    const childWatcher = new ManualWatcher();
    const watchedFolders: string[] = [];
    const { rootPath, listings } = await createHarness({
      watchIgnoreGlobs: ['**/node_modules/**'],
      watchFolder: (folder) => {
        watchedFolders.push(folder.segments.at(-1) ?? '');
        return childRoot(folder, childWatcher);
      },
      lingerMs: 10,
    });
    await mkdir(path.join(rootPath, 'node_modules'));
    await acquire(listings, '');
    const lease = listings.acquire(relativePath('node_modules'));
    const { state } = await lease.ready();
    expect(watchedFolders).toEqual(['node_modules']);
    await vi.waitFor(() => expect(childWatcher.active).toBe(true));

    await writeFile(path.join(rootPath, 'node_modules/react.js'), '');
    childWatcher.emit([{ kind: 'create', path: path.join(rootPath, 'node_modules/react.js') }]);
    await vi.waitFor(() => expect(names(peek(state))).toEqual(['react.js']));

    await lease.release();
    await vi.waitFor(() => expect(childWatcher.active).toBe(false));
  });

  it('stops queued work when disposed', async () => {
    const { listings } = await createHarness();
    const { refresh } = await acquire(listings, '');
    const readFolder = vi.spyOn(ListingReader.prototype, 'readFolder');

    const refreshing = refresh();
    await listings.dispose();
    await refreshing;

    expect(readFolder.mock.calls.length).toBeLessThanOrEqual(1);
    expect(() => listings.acquire(relativePath(''))).toThrow('disposed');
  });
});

async function acquire(listings: RootListings, folder: string) {
  const lease = listings.acquire(relativePath(folder));
  cleanups.push(() => lease.release());
  return lease.ready();
}

function entries(listing: FolderListing) {
  return listing.status === 'ready' ? listing.entries : {};
}

function names(listing: FolderListing): string[] {
  return Object.keys(entries(listing)).sort();
}

class ManualWatcher implements IWatchService {
  private onResync: (() => void) | undefined;
  private onEvents: ((events: WatchEvent[]) => void) | undefined;

  get active(): boolean {
    return this.onEvents !== undefined;
  }

  watch(_root: string, onEvents: (events: WatchEvent[]) => void, options: WatchOptions = {}) {
    this.onEvents = onEvents;
    this.onResync = options.onResync;
    return {
      ready: async () => ok(undefined),
      release: async () => {
        this.onEvents = undefined;
        this.onResync = undefined;
      },
    };
  }

  emit(events: WatchEvent[]): void {
    this.onEvents?.(events);
  }

  resync(): void {
    this.onResync?.();
  }

  async dispose(): Promise<void> {
    this.onEvents = undefined;
    this.onResync = undefined;
  }
}

function childRoot(folder: HostAbsolutePath, watcher: IWatchService): PendingLease<RootResource> {
  const resource = resolveRootIdentity(folder, 'children').then(async (identity) => {
    if (!identity.success) throw new Error(identity.error.type);
    return RootResource.create({ identity: identity.data, watcher, watchIgnoreGlobs: ['*/**'] });
  });
  return {
    ready: () => resource,
    release: async () => (await resource).dispose(),
  };
}

async function createHarness(
  options: Partial<Omit<RootListingsOptions, 'root'>> & { watchIgnoreGlobs?: string[] } = {}
) {
  const rootPath = await realpath(await mkdtemp(path.join(tmpdir(), 'emdash-root-listings-')));
  cleanups.push(() => rm(rootPath, { recursive: true, force: true }));
  const identity = await resolveRootIdentity(runtimeRoot(rootPath));
  if (!identity.success) throw new Error(`Unable to resolve test root: ${identity.error.type}`);
  const watcher = new ManualWatcher();
  const root = await RootResource.create({
    identity: identity.data,
    watcher,
    watchIgnoreGlobs: options.watchIgnoreGlobs,
  });
  cleanups.push(() => root.dispose());
  const listings = new RootListings({ ...options, root });
  cleanups.push(() => listings.dispose());
  return { rootPath, listings, watcher, root };
}
