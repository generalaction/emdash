import type { Scope } from '@emdash/shared/concurrency';
import type { FileSearchStore, StoredFileSearchRoot } from '@runtimes/file-search/node/store';
import type { IWatchService } from '@services/fs-watch/api';
import type { FileSearchExclusionPolicy } from './exclusions';
import type { FileScanner } from './scanner';

export type RootIndexOptions = Readonly<{
  root: StoredFileSearchRoot;
  store: FileSearchStore;
  watcher: IWatchService;
  scanner: FileScanner;
  exclusionPolicy: FileSearchExclusionPolicy;
  scope: Scope;
  maxIndexedFiles?: number;
  onError?: (context: string, error: unknown) => void;
}>;

/** Lifecycle resource that keeps one registered root's published generation current. */
export interface RootIndex {
  reconcile(): void;
}
