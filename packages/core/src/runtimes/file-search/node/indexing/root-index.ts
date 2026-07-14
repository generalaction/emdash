import path from 'node:path';
import type { Run, Scope } from '@emdash/shared/concurrency';
import { ROOT_RELATIVE_PATH, type PortableRelativePath } from '@primitives/path/api';
import type {
  PathIndexBuild,
  PathIndexEntry,
  PathIndexPatch,
  PathIndexStore,
  StoredFileSearchRoot,
} from '@runtimes/file-search/node/path-index-store';
import type { IWatchService, WatchEvent, WatchHandle } from '@services/fs-watch/api';
import { containsNativePath, portableRelativePathFromNative } from '../native-path';
import { RootWatchReadyError } from './errors';
import type { FileSearchExclusions } from './exclusions';
import type { PathScanner } from './scanner';

const WATCH_DEBOUNCE_MS = 50;
const SCAN_WRITE_BATCH_SIZE = 500;

type RunPathScan = <T>(signal: AbortSignal, operation: () => Promise<T>) => Promise<T>;

type RootIndexOptions = Readonly<{
  root: StoredFileSearchRoot;
  store: PathIndexStore;
  watcher: IWatchService;
  scanner: PathScanner;
  exclusions: FileSearchExclusions;
  scope: Scope;
  runScan: RunPathScan;
  onError?: (context: string, error: unknown) => void;
}>;

export interface RootIndexStatus {
  readonly failure: unknown | undefined;
  /** True only after this runtime has reconciled the persisted generation with the filesystem. */
  readonly ready: boolean;
}

/** Keeps one registered root's published path generation current. */
export class RootIndex implements RootIndexStatus {
  private readonly scope: Scope;
  private readonly watch: WatchHandle;
  private phase: { kind: 'published' } | { kind: 'building'; patches: PathIndexPatch[] } = {
    kind: 'published',
  };
  private patchLane: Promise<void> = Promise.resolve();
  private reconcileRun: Run<void> | undefined;
  private reconcileAgain = false;
  private lastFailure: unknown | undefined;
  private indexReady = false;

  constructor(private readonly options: RootIndexOptions) {
    this.scope = options.scope.child(`file-search-root-${options.root.id}`);
    this.watch = options.watcher.watch(
      options.root.rootPath,
      (events) => this.enqueueEvents(events),
      {
        debounceMs: WATCH_DEBOUNCE_MS,
        ignore: [...options.exclusions.watchIgnoreGlobs()],
        onResync: () => this.requestReconcile(),
      }
    );
    this.scope.add(() => this.watch.release());
  }

  get failure(): unknown | undefined {
    return this.lastFailure;
  }

  get ready(): boolean {
    return this.indexReady;
  }

  /** Coalesces concurrent requests and settles when the current reconciliation attempt settles. */
  reconcile(): Promise<void> {
    if (this.scope.state !== 'open') {
      return Promise.reject(new Error('Root index is disposed'));
    }
    if (this.reconcileRun) return this.reconcileRun.value();

    this.indexReady = false;
    const run = this.scope.run('reconcile', (signal) => this.reconcileLoop(signal));
    this.reconcileRun = run;
    void run.exit.then(() => {
      if (this.reconcileRun === run) this.reconcileRun = undefined;
      if (this.reconcileAgain && this.scope.state === 'open') {
        this.reconcileAgain = false;
        this.requestReconcile();
      }
    });
    return run.value();
  }

  private async reconcileLoop(signal: AbortSignal): Promise<void> {
    do {
      this.reconcileAgain = false;
      await this.reconcileOnce(signal);
    } while (this.reconcileAgain && this.scope.state === 'open');
  }

  private async reconcileOnce(signal: AbortSignal): Promise<void> {
    let build: PathIndexBuild | undefined;
    try {
      try {
        await waitWithSignal(this.watch.ready(), signal);
      } catch (error) {
        if (signal.aborted) throw error;
        throw new RootWatchReadyError(error);
      }
      throwIfAborted(signal);
      const activeBuild = this.options.store.beginBuild(this.options.root.id);
      build = activeBuild;
      this.phase = { kind: 'building', patches: [] };

      await this.options.runScan(signal, () => this.populateBuild(activeBuild, signal));

      // Events already queued run before this barrier. Later events run after the synchronous
      // publish below and therefore patch the newly-published generation.
      const barrier = this.patchLane.then(() => undefined);
      this.patchLane = barrier;
      await waitWithSignal(barrier, signal);
      throwIfAborted(signal);

      const finalPatches = this.phase.kind === 'building' ? this.phase.patches : [];
      activeBuild.publish(finalPatches);
      this.phase = { kind: 'published' };
      if (!this.reconcileAgain) {
        this.lastFailure = undefined;
        this.indexReady = true;
      }
    } catch (error) {
      if (build) {
        try {
          build.discard();
        } catch (discardError) {
          this.report('file-search path-index discard failed', discardError);
        }
      }
      this.phase = { kind: 'published' };
      this.lastFailure = error;
      this.indexReady = false;
      throw error;
    }
  }

  private async populateBuild(build: PathIndexBuild, signal: AbortSignal): Promise<void> {
    let batch: PathIndexEntry[] = [];
    for await (const entry of this.options.scanner.scan(
      this.options.root.rootPath,
      ROOT_RELATIVE_PATH,
      { signal, exclusions: this.options.exclusions }
    )) {
      batch.push(entry);
      if (batch.length < SCAN_WRITE_BATCH_SIZE) continue;
      build.append(batch);
      batch = [];
    }
    if (batch.length > 0) build.append(batch);
  }

  private enqueueEvents(events: WatchEvent[]): void {
    if (this.scope.state !== 'open' || events.length === 0) return;
    const previous = this.patchLane;
    const run = this.scope.run('watch-patch', async (signal) => {
      await waitWithSignal(previous, signal);
      const paths = this.coalesceEventPaths(events);
      if (paths.some((entry) => entry === ROOT_RELATIVE_PATH)) {
        this.requestReconcile();
        return;
      }

      const patches: PathIndexPatch[] = [];
      for (const relativePath of paths) {
        patches.push(await this.patchForPath(relativePath, signal));
      }
      if (patches.length === 0) return;

      if (this.phase.kind === 'building') this.phase.patches.push(...patches);
      else this.options.store.applyPublishedPatches(this.options.root.id, patches);
    });
    this.patchLane = run.value().catch((error: unknown) => {
      if (this.scope.signal.aborted) return;
      this.lastFailure = error;
      this.indexReady = false;
      this.report('file-search watcher patch failed', error);
      this.requestReconcile();
    });
  }

  private coalesceEventPaths(events: WatchEvent[]): PortableRelativePath[] {
    const paths = new Set<PortableRelativePath>();
    for (const event of events) {
      if (!path.isAbsolute(event.path)) continue;
      const absolutePath = path.resolve(event.path);
      if (!containsNativePath(this.options.root.rootPath, absolutePath)) continue;
      const relativePath = portableRelativePathFromNative(this.options.root.rootPath, absolutePath);
      if (relativePath !== null && !this.options.exclusions.excludes(relativePath)) {
        paths.add(relativePath);
      }
    }

    const ordered = [...paths].sort((left, right) => depth(left) - depth(right));
    return ordered.filter(
      (candidate, index) =>
        !ordered.slice(0, index).some((parent) => isSameOrDescendant(parent, candidate))
    );
  }

  private async patchForPath(
    relativePath: PortableRelativePath,
    signal: AbortSignal
  ): Promise<PathIndexPatch> {
    const entries: PathIndexEntry[] = [];
    await this.options.runScan(signal, async () => {
      for await (const entry of this.options.scanner.scan(
        this.options.root.rootPath,
        relativePath,
        { signal, exclusions: this.options.exclusions }
      )) {
        entries.push(entry);
      }
    });

    if (entries.length === 1 && entries[0].path === relativePath && entries[0].kind === 'file') {
      return { kind: 'upsert', entry: entries[0] };
    }
    if (entries.length === 0) return { kind: 'delete-subtree', path: relativePath };
    return { kind: 'replace-subtree', path: relativePath, entries };
  }

  private requestReconcile(): void {
    if (this.scope.state !== 'open') return;
    if (this.reconcileRun) {
      this.reconcileAgain = true;
      return;
    }
    void this.reconcile().catch((error: unknown) => {
      if (!this.scope.signal.aborted) {
        this.report('file-search reconciliation failed', error);
      }
    });
  }

  private report(context: string, error: unknown): void {
    this.options.onError?.(context, error);
  }
}

function depth(path: PortableRelativePath): number {
  return path === '' ? 0 : path.split('/').length;
}

function isSameOrDescendant(
  parent: PortableRelativePath,
  candidate: PortableRelativePath
): boolean {
  return parent === '' || candidate === parent || candidate.startsWith(`${parent}/`);
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error('Root index cancelled');
}

function waitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      cleanup();
      reject(abortReason(signal));
    };
    const cleanup = (): void => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      }
    );
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Root index cancelled');
}
