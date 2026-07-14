import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createScope } from '@emdash/shared/concurrency';
import { deferred } from '@emdash/shared/testing';
import type { PortableRelativePath } from '@primitives/path/api';
import type { PathSearchHit } from '@runtimes/file-search/api';
import type {
  PathIndexBuild,
  PathIndexEntry,
  PathIndexPatch,
  PathIndexStore,
} from '@runtimes/file-search/node/storage/path-index-store';
import type { IWatchService, WatchEvent, WatchHandle, WatchOptions } from '@services/fs-watch/api';
import { afterEach, describe, expect, it } from 'vitest';
import { SqlitePathIndexStore } from '../storage/sqlite-path-index-store';
import { DefaultFileSearchExclusions } from '../exclusions';
import { RootIndex } from './root-index';
import { NodePathScanner, type PathScanner, type PathScanOptions } from './scanner';

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe('RootIndex', () => {
  it('publishes a full scan and translates file and directory watch signals into patches', async () => {
    const rootPath = await createRoot();
    await mkdir(path.join(rootPath, 'src'));
    await writeFile(path.join(rootPath, 'src', 'old.ts'), 'old');
    const store = createStore();
    const root = store.upsertRoot({ rootKey: 'root-key', rootPath }).root;
    const watcher = new FakeWatchService();
    const scope = createScope({ label: 'root-index-test' });
    const index = new RootIndex({
      root,
      store,
      watcher,
      scanner: new NodePathScanner(),
      exclusions: new DefaultFileSearchExclusions({ caseSensitive: true }),
      scope,
      runScan: async (_signal, operation) => operation(),
    });
    cleanups.push(() => scope.dispose());

    await index.reconcile();
    expect(hits(store)).toEqual([
      { path: 'src', kind: 'directory' },
      { path: 'src/old.ts', kind: 'file' },
    ]);

    await rm(path.join(rootPath, 'src'), { recursive: true });
    watcher.emit([{ kind: 'delete', path: path.join(rootPath, 'src') }]);
    await eventually(() => expect(hits(store)).toEqual([]));

    await mkdir(path.join(rootPath, 'lib'));
    await writeFile(path.join(rootPath, 'lib', 'new.ts'), 'new');
    watcher.emit([{ kind: 'create', path: path.join(rootPath, 'lib') }]);
    await eventually(() =>
      expect(hits(store)).toEqual([
        { path: 'lib', kind: 'directory' },
        { path: 'lib/new.ts', kind: 'file' },
      ])
    );
  });

  it('fully reconciles after the watcher reports a possible event gap', async () => {
    const rootPath = await createRoot();
    const store = createStore();
    const root = store.upsertRoot({ rootKey: 'root-key', rootPath }).root;
    const watcher = new FakeWatchService();
    const scope = createScope({ label: 'root-index-resync-test' });
    const index = new RootIndex({
      root,
      store,
      watcher,
      scanner: new NodePathScanner(),
      exclusions: new DefaultFileSearchExclusions({ caseSensitive: true }),
      scope,
      runScan: async (_signal, operation) => operation(),
    });
    cleanups.push(() => scope.dispose());
    await index.reconcile();

    await writeFile(path.join(rootPath, 'unreported.ts'), 'new');
    watcher.resync();
    await eventually(() => expect(hits(store)).toEqual([{ path: 'unreported.ts', kind: 'file' }]));
  });

  it('applies watcher patches observed while an unpublished generation is still scanning', async () => {
    const rootPath = await createRoot();
    await writeFile(path.join(rootPath, 'before.ts'), 'before');
    const store = createStore();
    const root = store.upsertRoot({ rootKey: 'root-key', rootPath }).root;
    const watcher = new FakeWatchService();
    const scanner = new SnapshotPausingScanner();
    const scope = createScope({ label: 'root-index-buffer-test' });
    const index = new RootIndex({
      root,
      store,
      watcher,
      scanner,
      exclusions: new DefaultFileSearchExclusions({ caseSensitive: true }),
      scope,
      runScan: async (_signal, operation) => operation(),
    });
    cleanups.push(() => scope.dispose());

    const reconcile = index.reconcile();
    await scanner.fullScanStarted.promise;
    await writeFile(path.join(rootPath, 'during.ts'), 'during');
    watcher.emit([{ kind: 'create', path: path.join(rootPath, 'during.ts') }]);
    await scanner.subtreeScanCompleted.promise;
    scanner.resumeFullScan.resolve();
    await reconcile;

    expect(hits(store)).toEqual([
      { path: 'before.ts', kind: 'file' },
      { path: 'during.ts', kind: 'file' },
    ]);
  });

  it('marks the index degraded before attempting watcher-patch recovery', async () => {
    const rootPath = await createRoot();
    const delegate = createStore();
    const root = delegate.upsertRoot({ rootKey: 'root-key', rootPath }).root;
    const failure = Object.assign(new Error('patch storage unavailable'), { code: 'SQLITE_BUSY' });
    const store = new PatchFailingStore(delegate, failure);
    const watcher = new FakeWatchService();
    const scanner = new RecoveryPausingScanner();
    const scope = createScope({ label: 'root-index-degraded-test' });
    const index = new RootIndex({
      root,
      store,
      watcher,
      scanner,
      exclusions: new DefaultFileSearchExclusions({ caseSensitive: true }),
      scope,
      runScan: async (_signal, operation) => operation(),
    });
    cleanups.push(() => scope.dispose());
    await index.reconcile();

    await writeFile(path.join(rootPath, 'new.ts'), 'new');
    watcher.emit([{ kind: 'create', path: path.join(rootPath, 'new.ts') }]);
    await scanner.recoveryStarted.promise;

    expect(index.failure).toBe(failure);
  });
});

class SnapshotPausingScanner implements PathScanner {
  readonly fullScanStarted = deferred<void>();
  readonly subtreeScanCompleted = deferred<void>();
  readonly resumeFullScan = deferred<void>();
  private readonly delegate = new NodePathScanner();

  async *scan(
    rootPath: string,
    relativeRoot: PortableRelativePath,
    options: PathScanOptions
  ): AsyncIterable<PathIndexEntry> {
    if (relativeRoot !== '') {
      yield* this.delegate.scan(rootPath, relativeRoot, options);
      this.subtreeScanCompleted.resolve();
      return;
    }

    const snapshot: PathIndexEntry[] = [];
    for await (const entry of this.delegate.scan(rootPath, relativeRoot, options)) {
      snapshot.push(entry);
    }
    this.fullScanStarted.resolve();
    await this.resumeFullScan.promise;
    for (const entry of snapshot) yield entry;
  }
}

class RecoveryPausingScanner implements PathScanner {
  readonly recoveryStarted = deferred<void>();
  private readonly delegate = new NodePathScanner();
  private fullScans = 0;

  async *scan(
    rootPath: string,
    relativeRoot: PortableRelativePath,
    options: PathScanOptions
  ): AsyncIterable<PathIndexEntry> {
    if (relativeRoot === '') {
      this.fullScans += 1;
      if (this.fullScans > 1) {
        this.recoveryStarted.resolve();
        await new Promise<void>((resolve) => {
          if (options.signal.aborted) resolve();
          else options.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return;
      }
    }
    yield* this.delegate.scan(rootPath, relativeRoot, options);
  }
}

class PatchFailingStore implements PathIndexStore {
  constructor(
    private readonly delegate: PathIndexStore,
    private readonly failure: unknown
  ) {}

  listRoots() {
    return this.delegate.listRoots();
  }

  upsertRoot(input: { rootKey: string; rootPath: string }) {
    return this.delegate.upsertRoot(input);
  }

  deleteRoot(rootKey: string): void {
    this.delegate.deleteRoot(rootKey);
  }

  beginBuild(rootId: number): PathIndexBuild {
    return this.delegate.beginBuild(rootId);
  }

  applyPublishedPatches(_rootId: number, _patches: readonly PathIndexPatch[]): void {
    throw this.failure;
  }

  searchPaths(...args: Parameters<PathIndexStore['searchPaths']>) {
    return this.delegate.searchPaths(...args);
  }

  close(): void {
    this.delegate.close();
  }
}

class FakeWatchService implements IWatchService {
  private onEvents: ((events: WatchEvent[]) => void) | undefined;
  private onResync: (() => void) | undefined;

  watch(
    _root: string,
    onEvents: (events: WatchEvent[]) => void,
    options: WatchOptions = {}
  ): WatchHandle {
    this.onEvents = onEvents;
    this.onResync = options.onResync;
    return { ready: async () => {}, release: async () => {} };
  }

  emit(events: WatchEvent[]): void {
    this.onEvents?.(events);
  }

  resync(): void {
    this.onResync?.();
  }

  async dispose(): Promise<void> {}
}

function createStore(): SqlitePathIndexStore {
  const store = new SqlitePathIndexStore({ databasePath: ':memory:' });
  cleanups.push(() => store.close());
  return store;
}

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'emdash-root-index-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  return realpath(root);
}

function hits(store: SqlitePathIndexStore): PathSearchHit[] {
  const result = store.searchPaths('root-key', '', ['file', 'directory'], 20);
  return result.kind === 'ready' ? result.hits : [];
}

async function eventually(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  }
  throw lastError;
}
