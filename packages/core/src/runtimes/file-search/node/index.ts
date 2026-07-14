export { fileSearchComponentConfigSchema, type FileSearchComponentConfig } from './component';
export type { OpenFileSearchDatabase } from './db/client';
export type { FileSearchRuntime, FileSearchRuntimeOptions } from './file-search-runtime';
export type { FileSearchExclusionPolicy, FileSearchPathKind } from './indexing/exclusions';
export type { FileSearchRootResolver, ResolvedFileSearchRoot } from './indexing/root-identity';
export type { RootIndex, RootIndexOptions } from './indexing/root-index';
export type { FileScanner } from './indexing/scanner';
export type {
  FileSearchIndexBuild,
  FileSearchIndexEntry,
  FileSearchIndexPatch,
  FileSearchRootUpsertResult,
  FileSearchStore,
  FileSearchStoreSearchResult,
  StoredFileSearchRoot,
} from './store';
