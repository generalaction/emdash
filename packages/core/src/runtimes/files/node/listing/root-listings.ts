import type { PendingLease } from '@emdash/shared';
import { createConcurrencyLimiter } from '@emdash/shared/concurrency';
import { cell, peek, revisionOf, type Cell, type Revision } from '@emdash/wire/state';
import {
  joinAbsolute,
  joinPortableRelativePath,
  portableRelativePathBasename,
  portableRelativePathDirname,
  portableRelativePathParts,
  type HostAbsolutePath,
  type PortableRelativePath,
} from '#primitives/path/api';
import {
  listingEntry,
  listingEntryKey,
  type FolderListing,
  type ListingEntries,
  type ListingEntry,
  type ListingEntryKey,
} from '#runtimes/files/api';
import { expectedFsError } from '#runtimes/files/node/api/errors';
import type {
  AbsoluteChange,
  RootChange,
  RootResource,
} from '#runtimes/files/node/root/root-resource';
import { ListingReader, type ReadEntry } from './listing-reader';

/** Folder reads one root issues at once; each read already stats its children in parallel. */
const FOLDER_READ_CONCURRENCY = 4;
/** Above this many changed children in one batch, relisting the folder beats statting each. */
const MAX_ENTRY_STATS = 64;
const DEFAULT_LINGER_MS = 30_000;
/** Children kept across closed-but-lingering folders before the oldest are dropped early. */
const DEFAULT_MAX_LINGERING_ENTRIES = 50_000;

export type FolderListingHandle = {
  readonly state: Cell<FolderListing>;
  /** Rereads this folder and every listed folder beneath it. */
  refresh(): Promise<Revision>;
};

export type RootListingsOptions = {
  root: RootResource;
  /** Watches one folder's direct children; used for folders the root's watch ignores. */
  watchFolder?: (folder: HostAbsolutePath) => PendingLease<RootResource>;
  lingerMs?: number;
  maxLingeringEntries?: number;
  onError?: (context: string, error: unknown) => void;
};

type ReadyListing = Extract<FolderListing, { status: 'ready' }>;

/** Changes waiting to be applied to one folder; merged until the folder's turn comes. */
type Update = {
  full: boolean;
  names: Set<string>;
  done: Promise<void>;
  resolve(): void;
};

type Folder = {
  readonly path: PortableRelativePath;
  readonly state: Cell<FolderListing>;
  ready: Promise<void>;
  /** Whether the folder has been read once; before that its state is a placeholder. */
  read: boolean;
  leases: number;
  releasedAt: number;
  lingerTimer: ReturnType<typeof setTimeout> | null;
  queue: Promise<void>;
  pending: Update | null;
  releaseWatch: (() => Promise<void>) | null;
};

/**
 * The listed folders of one workspace root, shared by every subscriber. A folder
 * is listed while anyone subscribes to it and kept briefly after the last one
 * leaves. Watcher events and the runtime's own mutations update listings in
 * place: a changed child is statted on its own, and a folder is only reread
 * when many children changed at once, after a watcher resync, or on refresh.
 * Updates to one folder run one at a time, so an older read never overwrites a
 * newer one.
 */
export class RootListings {
  private readonly folders = new Map<PortableRelativePath, Folder>();
  private readonly reader: ListingReader;
  private readonly limiter = createConcurrencyLimiter(FOLDER_READ_CONCURRENCY);
  private readonly lifetime = new AbortController();
  private readonly unsubscribeRoot: () => void;
  private readonly onError: (context: string, error: unknown) => void;
  private readonly lingerMs: number;
  private readonly maxLingeringEntries: number;
  private disposed = false;

  constructor(private readonly options: RootListingsOptions) {
    this.reader = new ListingReader(options.root.paths);
    this.onError = options.onError ?? (() => {});
    this.lingerMs = options.lingerMs ?? DEFAULT_LINGER_MS;
    this.maxLingeringEntries = options.maxLingeringEntries ?? DEFAULT_MAX_LINGERING_ENTRIES;
    this.unsubscribeRoot = options.root.subscribe((changes) => void this.route(changes));
  }

  acquire(path: PortableRelativePath): PendingLease<FolderListingHandle> {
    this.assertActive();
    const folder = this.folders.get(path) ?? this.materialize(path);
    folder.leases += 1;
    if (folder.lingerTimer) {
      clearTimeout(folder.lingerTimer);
      folder.lingerTimer = null;
    }
    const handle: FolderListingHandle = {
      state: folder.state,
      refresh: () => this.refresh(folder),
    };
    let released = false;
    return {
      ready: async () => {
        await folder.ready;
        return handle;
      },
      release: async () => {
        if (released) return;
        released = true;
        this.release(folder);
      },
    };
  }

  /**
   * Reflects the files runtime's own successful mutations at ack time. The same
   * changes usually also arrive through the root subscription; both join the
   * same pending update, so each touched folder is read once.
   */
  applyAbsoluteChanges(changes: readonly AbsoluteChange[]): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const relative = changes.flatMap((change): RootChange[] => {
      const path = this.options.root.paths.toRelative(change.absolutePath);
      return path === null ? [] : [{ kind: change.kind, path }];
    });
    return this.route(relative);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeRoot();
    this.lifetime.abort(new Error('Folder listings are disposed'));
    const folders = [...this.folders.values()];
    this.folders.clear();
    for (const folder of folders) this.stop(folder);
    await Promise.all(folders.map((folder) => folder.queue));
  }

  private materialize(path: PortableRelativePath): Folder {
    const folder: Folder = {
      path,
      // Replaced by the first read before any subscriber sees it.
      state: cell<FolderListing>(
        { status: 'ready', entries: {} },
        { name: `files.listing:${path}` }
      ),
      ready: Promise.resolve(),
      read: false,
      leases: 0,
      releasedAt: 0,
      lingerTimer: null,
      queue: Promise.resolve(),
      pending: null,
      releaseWatch: null,
    };
    this.folders.set(path, folder);
    folder.ready = this.update(folder, { full: true });
    if (!this.options.root.watchesListing(path)) this.watchChildren(folder);
    return folder;
  }

  /**
   * Folders the root's watch ignores (dependency folders, by default) get a
   * watch of their own direct children for as long as they are listed.
   */
  private watchChildren(folder: Folder): void {
    const watchFolder = this.options.watchFolder;
    if (!watchFolder) return;
    const absolute = joinAbsolute(
      this.options.root.identity.root,
      ...portableRelativePathParts(folder.path)
    );
    if (!absolute.success) return;
    const lease = watchFolder(absolute.data);
    let unsubscribe: (() => void) | null = null;
    let stopped = false;
    folder.releaseWatch = async () => {
      stopped = true;
      unsubscribe?.();
      await lease.release();
    };
    lease.ready().then(
      (watched) => {
        if (stopped) return;
        unsubscribe = watched.subscribe((changes) => {
          const children: RootChange[] = [];
          for (const change of changes) {
            if (change.kind === 'resync' || change.path === '') {
              void this.update(folder, { full: true });
              continue;
            }
            const path = joinPortableRelativePath(folder.path, change.path);
            if (path.success) children.push({ kind: change.kind, path: path.data });
          }
          void this.route(children);
        });
      },
      (error: unknown) => {
        // A folder that does not exist has nothing to watch; its listing says so.
        if (!stopped && !expectedFsError(error)) {
          this.onError(`files listing watch ${folder.path}`, error);
        }
      }
    );
  }

  private release(folder: Folder): void {
    folder.leases -= 1;
    if (folder.leases > 0 || this.disposed || this.folders.get(folder.path) !== folder) return;
    folder.releasedAt = Date.now();
    folder.lingerTimer = setTimeout(() => this.evict(folder), this.lingerMs);
    folder.lingerTimer.unref?.();
    this.trimLingering();
  }

  private trimLingering(): void {
    const lingering = [...this.folders.values()]
      .filter((folder) => folder.leases === 0)
      .sort((left, right) => left.releasedAt - right.releasedAt);
    let total = lingering.reduce((sum, folder) => sum + entryCount(folder), 0);
    for (const folder of lingering) {
      if (total <= this.maxLingeringEntries) break;
      total -= entryCount(folder);
      this.evict(folder);
    }
  }

  private evict(folder: Folder): void {
    if (folder.leases > 0 || this.folders.get(folder.path) !== folder) return;
    this.folders.delete(folder.path);
    this.stop(folder);
  }

  private stop(folder: Folder): void {
    if (folder.lingerTimer) clearTimeout(folder.lingerTimer);
    folder.lingerTimer = null;
    folder.pending?.resolve();
    folder.pending = null;
    folder.releaseWatch?.().catch((error: unknown) => {
      this.onError(`files listing watch release ${folder.path}`, error);
    });
    folder.releaseWatch = null;
  }

  /** Applies changes to the listings they touch; resolves once those listings reflect them. */
  private route(changes: readonly RootChange[]): Promise<void> {
    if (this.disposed || changes.length === 0) return Promise.resolve();
    const updates: Promise<void>[] = [];
    if (changes.some((change) => change.kind === 'resync')) {
      for (const folder of this.folders.values()) updates.push(this.update(folder, { full: true }));
      return settled(updates);
    }
    for (const change of changes) {
      if (change.kind === 'resync') continue;
      const parentPath = portableRelativePathDirname(change.path);
      const parent = parentPath === null ? undefined : this.folders.get(parentPath);
      if (parent) {
        updates.push(this.update(parent, { name: portableRelativePathBasename(change.path) }));
      }
      // A folder that appeared or disappeared, or changed without a listed parent to
      // notice, is reread along with everything listed beneath it.
      if (change.kind !== 'update' || !parent) {
        for (const folder of this.foldersAtOrUnder(change.path)) {
          updates.push(this.update(folder, { full: true }));
        }
      }
    }
    return settled(updates);
  }

  private update(folder: Folder, change: { full: true } | { name: string }): Promise<void> {
    let pending = folder.pending;
    if (!pending) {
      const created = createUpdate();
      pending = created;
      folder.pending = created;
      folder.queue = folder.queue.then(() => this.run(folder, created));
    }
    if ('full' in change) pending.full = true;
    else pending.names.add(change.name);
    return pending.done;
  }

  private async run(folder: Folder, update: Update): Promise<void> {
    if (folder.pending === update) folder.pending = null;
    try {
      if (this.disposed || this.folders.get(folder.path) !== folder) return;
      const current = peek(folder.state);
      if (update.full || current.status !== 'ready' || update.names.size > MAX_ENTRY_STATS) {
        await this.relist(folder);
      } else {
        await this.restat(folder, current, [...update.names]);
      }
    } catch (error) {
      if (!this.disposed) this.onError(`files listing ${folder.path}`, error);
    } finally {
      update.resolve();
    }
  }

  private async relist(folder: Folder): Promise<void> {
    const read = await this.limiter.run(this.lifetime.signal, () =>
      this.reader.readFolder(folder.path)
    );
    if (this.folders.get(folder.path) !== folder) return;
    const previous = peek(folder.state);
    const next: FolderListing = read.success
      ? { status: 'ready', entries: reuseEntries(previous, read.data) }
      : { status: 'error', error: read.error };
    if (folder.read) {
      this.publish(folder, previous, next);
    } else {
      folder.read = true;
      if (!sameListing(previous, next)) folder.state.set(next);
    }
  }

  private async restat(folder: Folder, previous: ReadyListing, names: string[]): Promise<void> {
    const reads = await Promise.all(
      names.map(async (name) => {
        const path = joinPortableRelativePath(folder.path, name);
        if (!path.success) return null;
        const read = await this.limiter.run(this.lifetime.signal, () =>
          this.reader.readEntry(path.data)
        );
        return { name, read };
      })
    );
    if (this.folders.get(folder.path) !== folder) return;
    let entries: ListingEntries | null = null;
    for (const result of reads) {
      if (!result) continue;
      const { name, read } = result;
      if (!read.success && read.error.type !== 'not-found') {
        await this.relist(folder);
        return;
      }
      const existing = listingEntry(previous.entries, name);
      if (read.success) {
        if (existing && sameEntry(existing, read.data.entry)) continue;
        entries ??= { ...previous.entries };
        entries[listingEntryKey(name)] = read.data.entry;
      } else if (existing) {
        entries ??= { ...previous.entries };
        delete entries[listingEntryKey(name)];
      }
    }
    if (entries) this.publish(folder, previous, { status: 'ready', entries });
  }

  private publish(folder: Folder, previous: FolderListing, next: FolderListing): void {
    if (sameListing(previous, next)) return;
    folder.state.set(next);
    // A child folder that appeared, vanished or changed kind has a stale listing of its own.
    for (const listed of this.folders.values()) {
      const name = childNameTowards(folder.path, listed.path);
      if (name !== null && entryOf(previous, name) !== entryOf(next, name)) {
        void this.update(listed, { full: true });
      }
    }
  }

  private async refresh(folder: Folder): Promise<Revision> {
    await settled(
      [...this.foldersAtOrUnder(folder.path)].map((listed) => this.update(listed, { full: true }))
    );
    return revisionOf(folder.state);
  }

  private *foldersAtOrUnder(path: PortableRelativePath): Iterable<Folder> {
    for (const folder of this.folders.values()) {
      if (path === '' || folder.path === path || folder.path.startsWith(`${path}/`)) yield folder;
    }
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Folder listings are disposed');
  }
}

function createUpdate(): Update {
  let resolve!: () => void;
  const done = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { full: false, names: new Set(), done, resolve };
}

function settled(updates: Promise<void>[]): Promise<void> {
  return Promise.all(updates).then(() => undefined);
}

/** Keeps the previous entry object for every child that did not change. */
function reuseEntries(previous: FolderListing, reads: readonly ReadEntry[]): ListingEntries {
  const entries: ListingEntries = {};
  for (const { name, entry } of reads) {
    const existing = entryOf(previous, name);
    entries[listingEntryKey(name)] = existing && sameEntry(existing, entry) ? existing : entry;
  }
  return entries;
}

function sameEntry(left: ListingEntry, right: ListingEntry): boolean {
  return (
    left.kind === right.kind &&
    left.symlinkTarget === right.symlinkTarget &&
    left.symlinkTargetKind === right.symlinkTargetKind &&
    left.symlinkTargetOutsideRoot === right.symlinkTargetOutsideRoot
  );
}

function sameListing(left: FolderListing, right: FolderListing): boolean {
  if (left.status === 'error' || right.status === 'error') {
    return (
      left.status === 'error' &&
      right.status === 'error' &&
      JSON.stringify(left.error) === JSON.stringify(right.error)
    );
  }
  const keys = Object.keys(left.entries) as ListingEntryKey[];
  if (keys.length !== Object.keys(right.entries).length) return false;
  return keys.every((key) => right.entries[key] === left.entries[key]);
}

function entryOf(listing: FolderListing, name: string): ListingEntry | undefined {
  return listing.status === 'ready' ? listingEntry(listing.entries, name) : undefined;
}

function entryCount(folder: Folder): number {
  const listing = peek(folder.state);
  return listing.status === 'ready' ? Object.keys(listing.entries).length : 0;
}

/** The child of `parent` on the way to `descendant`, or null when it is not beneath it. */
function childNameTowards(
  parent: PortableRelativePath,
  descendant: PortableRelativePath
): string | null {
  if (descendant === parent) return null;
  if (parent === '') return descendant.split('/')[0] ?? null;
  if (!descendant.startsWith(`${parent}/`)) return null;
  return descendant.slice(parent.length + 1).split('/')[0] ?? null;
}
