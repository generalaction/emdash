import type { Scope } from '@emdash/shared/concurrency';
import type {
  PathIndexStore,
  StoredFileSearchRoot,
} from '@runtimes/file-search/node/path-index-store';
import type { IWatchService } from '@services/fs-watch/api';
import type { FileSearchExclusionPolicy } from './exclusions';
import type { PathScanner } from './scanner';

export type RootIndexOptions = Readonly<{
  root: StoredFileSearchRoot;
  store: PathIndexStore;
  watcher: IWatchService;
  scanner: PathScanner;
  exclusionPolicy: FileSearchExclusionPolicy;
  scope: Scope;
  onError?: (context: string, error: unknown) => void;
}>;

/** Lifecycle resource that keeps one registered root's published generation current. */
export interface RootIndex {
  /** Coalesces concurrent requests and settles when the current generation is published. */
  reconcile(): Promise<void>;
}
