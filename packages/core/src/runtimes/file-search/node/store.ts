import type { PortableRelativePath } from '@primitives/path/api';
import type { FileSearchHit } from '@runtimes/file-search/api';

export type StoredFileSearchRoot = Readonly<{
  id: number;
  rootKey: string;
  rootPath: string;
}>;

/** A changed canonical path invalidates any generation published for the previous path. */
export type FileSearchRootUpsertResult =
  | Readonly<{ kind: 'created'; root: StoredFileSearchRoot }>
  | Readonly<{ kind: 'unchanged'; root: StoredFileSearchRoot }>
  | Readonly<{ kind: 'root-path-changed'; root: StoredFileSearchRoot }>;

export type FileSearchIndexEntry = Readonly<{
  path: PortableRelativePath;
  filename: string;
}>;

export type FileSearchIndexPatch =
  | Readonly<{ kind: 'upsert'; entry: FileSearchIndexEntry }>
  | Readonly<{ kind: 'delete-subtree'; path: PortableRelativePath }>
  | Readonly<{
      kind: 'replace-subtree';
      path: PortableRelativePath;
      entries: readonly FileSearchIndexEntry[];
    }>;

export type FileSearchStoreSearchResult =
  | Readonly<{ kind: 'ready'; hits: FileSearchHit[] }>
  | Readonly<{ kind: 'not-ready' }>;

/** An unpublished generation being populated by one full-root scan. */
export interface FileSearchIndexBuild {
  append(entries: readonly FileSearchIndexEntry[]): void;
  publish(finalPatches: readonly FileSearchIndexPatch[]): void;
  discard(): void;
}

/** Persistence port implemented by the private file-search database adapter. */
export interface FileSearchStore {
  listRoots(): StoredFileSearchRoot[];
  upsertRoot(input: { rootKey: string; rootPath: string }): FileSearchRootUpsertResult;
  deleteRoot(rootKey: string): boolean;

  beginBuild(rootId: number): FileSearchIndexBuild;
  applyPublishedPatches(rootId: number, patches: readonly FileSearchIndexPatch[]): void;

  search(rootKey: string, query: string, limit: number): FileSearchStoreSearchResult;
  close(): void;
}
