import type { Scope } from '@emdash/shared/concurrency';
import type { IWatchService } from '@services/fs-watch/api';
import type { ConcurrencyLimiter } from '../concurrency-limiter';
import type { FileSearchExclusions } from '../exclusions';
import { RootIndex } from '../path/index/root-index';
import type { PathScanner } from '../path/index/scanner';
import type { PathIndexStore } from '../storage/types';
import type { StoredFileSearchRoot } from '../storage/root-catalog-store';

export type RegisteredRoot = Readonly<{
  record: StoredFileSearchRoot;
  index: RootIndex;
  scope: Scope;
}>;

export type CreateRegisteredRootOptions = Readonly<{
  record: StoredFileSearchRoot;
  indexStore: PathIndexStore;
  watcher: IWatchService;
  scanner: PathScanner;
  exclusions: FileSearchExclusions;
  scope: Scope;
  scanLimiter: ConcurrencyLimiter;
  onError?: (context: string, error: unknown) => void;
}>;

/** Builds one registered root and starts its path-index reconciliation in the background. */
export function createRegisteredRoot(options: CreateRegisteredRootOptions): RegisteredRoot {
  const index = new RootIndex({
    root: options.record,
    store: options.indexStore,
    watcher: options.watcher,
    scanner: options.scanner,
    exclusions: options.exclusions,
    scope: options.scope,
    runScan: (signal, operation) => options.scanLimiter.run(signal, operation),
    onError: options.onError,
  });
  void index.reconcile().catch((error: unknown) => {
    if (!options.scope.signal.aborted) {
      options.onError?.('file-search reconciliation failed', error);
    }
  });
  return { record: options.record, index, scope: options.scope };
}
