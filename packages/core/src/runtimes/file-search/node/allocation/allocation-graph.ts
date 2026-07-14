import type { Result } from '@emdash/shared';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import type { HostAbsolutePath } from '@primitives/path/api';
import type {
  FileSearchRegisterRootError,
  FileSearchRootInput,
  FileSearchUnregisterRootError,
} from '@runtimes/file-search/api';
import type { IWatchService } from '@services/fs-watch/api';
import { createNativeWatchService } from '@services/fs-watch/node';
import { ConcurrencyLimiter } from '../concurrency-limiter';
import { RipgrepContentSearcher } from '../content/ripgrep-content-searcher';
import { DefaultFileSearchExclusions } from '../exclusions';
import { NodePathScanner } from '../path-index/scanner';
import {
  FileSearchRootRegistry,
  type FileSearchRootLookup,
  type FileSearchRootState,
} from '../root/root-registry';
import { SqlitePathIndexStore } from '../storage/sqlite-path-index-store';
import { NodeFileSearchRootResolver } from './root-identity';

const DEFAULT_MAX_CONCURRENT_SCANS = 2;
const DEFAULT_MAX_CONCURRENT_CONTENT_SEARCHES = 4;

export type FileSearchAllocationGraphOptions = Readonly<{
  databasePath: string;
  watcher?: IWatchService;
  ripgrepPath?: string;
  env?: NodeJS.ProcessEnv;
  maxConcurrentScans?: number;
  maxConcurrentContentSearches?: number;
  onError?: (context: string, error: unknown) => void;
}>;

/** Owns the host-scoped resources shared by all file-search domain runtimes. */
export class FileSearchAllocationGraph implements FileSearchRootLookup {
  private readonly scope: Scope;
  private readonly roots: FileSearchRootRegistry;
  private readonly store: SqlitePathIndexStore;
  private readonly watcher: IWatchService;
  private readonly ownsWatcher: boolean;
  private disposePromise: Promise<void> | undefined;

  constructor(options: FileSearchAllocationGraphOptions) {
    const onError = options.onError ?? (() => {});
    this.scope = createScope({
      label: 'file-search-runtime',
      onCleanupError: (error) => onError('file-search cleanup failed', error),
    });
    try {
      this.store = new SqlitePathIndexStore({ databasePath: options.databasePath });
    } catch (error) {
      void this.scope.dispose(error);
      throw error;
    }
    this.ownsWatcher = options.watcher === undefined;

    let watcher: IWatchService | undefined;
    try {
      watcher = options.watcher ?? createNativeWatchService({ onError });
      this.watcher = watcher;
      const exclusions = new DefaultFileSearchExclusions();
      this.roots = new FileSearchRootRegistry({
        store: this.store,
        watcher,
        scanner: new NodePathScanner(),
        resolver: new NodeFileSearchRootResolver(),
        exclusions,
        scanLimiter: new ConcurrencyLimiter(
          options.maxConcurrentScans ?? DEFAULT_MAX_CONCURRENT_SCANS
        ),
        contentLimiter: new ConcurrencyLimiter(
          options.maxConcurrentContentSearches ?? DEFAULT_MAX_CONCURRENT_CONTENT_SEARCHES
        ),
        contentSearcher: new RipgrepContentSearcher({
          executable: options.ripgrepPath,
          env: options.env,
          exclusions,
        }),
        scope: this.scope,
        onError,
      });
    } catch (error) {
      let constructionError = error;
      try {
        this.store.close();
      } catch (closeError) {
        constructionError = new AggregateError(
          [error, closeError],
          'File-search construction cleanup failed'
        );
      }
      if (this.ownsWatcher && watcher) {
        void watcher.dispose().catch((disposeError: unknown) => {
          onError('file-search watcher cleanup failed', disposeError);
        });
      }
      void this.scope.dispose(constructionError);
      throw constructionError;
    }
  }

  registerRoot(input: FileSearchRootInput): Promise<Result<void, FileSearchRegisterRootError>> {
    return this.roots.registerRoot(input);
  }

  unregisterRoot(input: FileSearchRootInput): Promise<Result<void, FileSearchUnregisterRootError>> {
    return this.roots.unregisterRoot(input);
  }

  state(root: HostAbsolutePath): FileSearchRootState {
    return this.roots.state(root);
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposePromise = this.disposeInternal();
    return this.disposePromise;
  }

  private async disposeInternal(): Promise<void> {
    const failures: unknown[] = [];
    await attemptCleanup(failures, () => this.roots.dispose());
    await attemptCleanup(failures, () =>
      this.scope.dispose(new Error('File-search runtime disposed'))
    );
    await attemptCleanup(failures, () => this.store.close());
    if (this.ownsWatcher) {
      await attemptCleanup(failures, () => this.watcher.dispose());
    }

    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, 'File-search disposal failed');
  }
}

async function attemptCleanup(
  failures: unknown[],
  cleanup: () => void | Promise<void>
): Promise<void> {
  try {
    await cleanup();
  } catch (error) {
    failures.push(error);
  }
}
