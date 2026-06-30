import type { Result } from '@emdash/shared';
import type { FileTreeOperationError } from './file-tree-errors';
import type { FileTreeProjectionScope } from './fsEvents';

/** Result of opening a per-view projection subscription: the seed root scope + baseline version. */
export type FileTreeProjectionOpenData = {
  subscriptionId: string;
  version: number;
  scopes: FileTreeProjectionScope[];
};
export type FileTreeProjectionOpenResult = Result<
  FileTreeProjectionOpenData,
  FileTreeOperationError
>;

/** Mutating a subscription (register/unregister/reveal) returns the version to wait for. */
export type FileTreeProjectionVersionData = {
  version: number;
};
export type FileTreeProjectionVersionResult = Result<
  FileTreeProjectionVersionData,
  FileTreeOperationError
>;

export type FileTreeProjectionCloseResult = Result<void, FileTreeOperationError>;
