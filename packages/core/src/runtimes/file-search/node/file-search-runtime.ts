import type { Result } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import type {
  FileSearchError,
  FileSearchQuery,
  FileSearchRegisterRootError,
  FileSearchRegisterRootInput,
  FileSearchResult,
  FileSearchUnregisterRootError,
  FileSearchUnregisterRootInput,
} from '@runtimes/file-search/api';
import type { IWatchService } from '@services/fs-watch/api';
import type { FileSearchExclusionPolicy } from './indexing/exclusions';
import type { FileSearchRootResolver } from './indexing/root-identity';
import type { FileScanner } from './indexing/scanner';
import type { FileSearchStore } from './store';

export type FileSearchRuntimeOptions = Readonly<{
  store: FileSearchStore;
  watcher: IWatchService;
  scanner: FileScanner;
  rootResolver: FileSearchRootResolver;
  exclusionPolicy: FileSearchExclusionPolicy;
  scope: Scope;
  maxIndexedFiles?: number;
  maxConcurrentScans?: number;
  onError?: (context: string, error: unknown) => void;
}>;

/** Host-scoped orchestration boundary exposed through the file-search Wire contract. */
export interface FileSearchRuntime {
  registerRoot(
    input: FileSearchRegisterRootInput
  ): Promise<Result<void, FileSearchRegisterRootError>>;
  unregisterRoot(
    input: FileSearchUnregisterRootInput
  ): Promise<Result<void, FileSearchUnregisterRootError>>;
  search(input: FileSearchQuery): Promise<Result<FileSearchResult, FileSearchError>>;
  dispose(): Promise<void>;
}
