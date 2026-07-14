export type StoredFileSearchRoot = Readonly<{
  id: number;
  rootKey: string;
  rootPath: string;
}>;

export type FileSearchRootUpsertResult = Readonly<{
  kind: 'created' | 'unchanged';
  root: StoredFileSearchRoot;
}>;

/** Persistence view used by the registered-root lifecycle policy. */
export interface RootCatalogStore {
  listRoots(): StoredFileSearchRoot[];
  upsertRoot(input: { rootKey: string; rootPath: string }): FileSearchRootUpsertResult;
  deleteRoot(rootKey: string): void;
}
