import type { FileTreeSequences, FileTreeSnapshot } from '@emdash/core/file-tree';
import type { Result } from '@emdash/shared';
import type { FileTreeOperationError } from './file-tree-errors';

export type FileTreeSnapshotResult = Result<FileTreeSnapshot, FileTreeOperationError>;

export type FileTreeMutationData = {
  sequences: FileTreeSequences;
};

export type FileTreeMutationResult = Result<FileTreeMutationData, FileTreeOperationError>;
