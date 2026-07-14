import type { Result } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import type {
  ContentSearchError,
  ContentSearchInput,
  ContentSearchResult,
  FileSearchRegisterRootError,
  FileSearchRootInput,
  FileSearchUnregisterRootError,
  PathSearchError,
  PathSearchInput,
  PathSearchResult,
} from '@runtimes/file-search/api';
import type { IWatchService } from '@services/fs-watch/api';
import type { ContentSearchContext, FileContentSearcher } from './content/content-searcher';
import type { FileSearchExclusionPolicy } from './indexing/exclusions';
import type { FileSearchRootResolver } from './indexing/root-identity';
import type { PathScanner } from './indexing/scanner';
import type { PathIndexStore } from './path-index-store';

export type FileSearchRuntimeOptions = Readonly<{
  pathIndex: PathIndexStore;
  contentSearcher: FileContentSearcher;
  watcher: IWatchService;
  scanner: PathScanner;
  rootResolver: FileSearchRootResolver;
  exclusionPolicy: FileSearchExclusionPolicy;
  scope: Scope;
  maxConcurrentScans?: number;
  maxConcurrentContentSearches?: number;
  onError?: (context: string, error: unknown) => void;
}>;

/** Host-scoped orchestration Interface exposed through the file-search Wire contract. */
export interface FileSearchRuntime {
  /** Idempotently persists interest and starts background reconciliation without awaiting it. */
  registerRoot(input: FileSearchRootInput): Promise<Result<void, FileSearchRegisterRootError>>;
  /** Idempotently stops maintenance and deletes the root's disposable path index. */
  unregisterRoot(input: FileSearchRootInput): Promise<Result<void, FileSearchUnregisterRootError>>;
  /** Returns `index-not-ready` while reconciling and `io` after a terminal reconcile failure. */
  searchPaths(input: PathSearchInput): Promise<Result<PathSearchResult, PathSearchError>>;
  searchContent(
    input: ContentSearchInput,
    context: ContentSearchContext
  ): Promise<Result<ContentSearchResult, ContentSearchError>>;
  dispose(): Promise<void>;
}
