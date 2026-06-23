import type { FileTreeError } from '@emdash/core/file-tree';

export type FileTreeNotFoundError = { type: 'not_found' };
export type FileTreeOperationError = FileTreeNotFoundError | FileTreeError;

export function fileTreeOperationErrorMessage(error: FileTreeOperationError): string {
  switch (error.type) {
    case 'not_found':
      return 'File tree not found';
    case 'fs-error':
    case 'invalid-path':
      return error.message;
    case 'not-directory':
      return `Path is not a directory: ${error.path ?? error.id ?? 'unknown'}`;
    case 'not-found':
      return `Path not found: ${error.path ?? error.id ?? 'unknown'}`;
  }
}
