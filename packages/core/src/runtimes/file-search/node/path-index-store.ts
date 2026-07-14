import type { PortableRelativePath } from '@primitives/path/api';
import type { PathEntryKind, PathSearchHit } from '@runtimes/file-search/api';

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

export type PathIndexEntry = Readonly<{
  path: PortableRelativePath;
  kind: PathEntryKind;
}>;

export type PathIndexPatch =
  | Readonly<{ kind: 'upsert'; entry: PathIndexEntry }>
  | Readonly<{ kind: 'delete-subtree'; path: PortableRelativePath }>
  | Readonly<{
      kind: 'replace-subtree';
      path: PortableRelativePath;
      entries: readonly PathIndexEntry[];
    }>;

export type PathIndexStoreSearchResult =
  | Readonly<{ kind: 'ready'; hits: PathSearchHit[] }>
  | Readonly<{ kind: 'not-ready' }>;

/** An unpublished generation being populated by one full-root scan. */
export interface PathIndexBuild {
  append(entries: readonly PathIndexEntry[]): void;
  publish(finalPatches: readonly PathIndexPatch[]): void;
  discard(): void;
}

/** Persistence port implemented by the private file-search database adapter. */
export interface PathIndexStore {
  listRoots(): StoredFileSearchRoot[];
  upsertRoot(input: { rootKey: string; rootPath: string }): FileSearchRootUpsertResult;
  deleteRoot(rootKey: string): void;

  beginBuild(rootId: number): PathIndexBuild;
  applyPublishedPatches(rootId: number, patches: readonly PathIndexPatch[]): void;

  /**
   * Treats `query` as literal user text and returns relevance-ordered hits. The Adapter owns
   * FTS escaping and the non-FTS fallback needed for queries shorter than three characters.
   */
  searchPaths(
    rootKey: string,
    query: string,
    kinds: readonly PathEntryKind[],
    limit: number
  ): PathIndexStoreSearchResult;
  close(): void;
}
