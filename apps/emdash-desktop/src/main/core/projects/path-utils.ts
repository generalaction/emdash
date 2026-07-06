import fs from 'node:fs';
import { isFileNotFoundException } from '@emdash/core/files';

export type DirectoryStatus =
  | { kind: 'directory' }
  | { kind: 'not-directory' }
  | { kind: 'inspect-failed'; message: string };

export function getDirectoryStatus(path: string): DirectoryStatus {
  try {
    return fs.statSync(path).isDirectory() ? { kind: 'directory' } : { kind: 'not-directory' };
  } catch (error) {
    if (isFileNotFoundException(error)) return { kind: 'not-directory' };
    return {
      kind: 'inspect-failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function checkIsValidDirectory(path: string): boolean {
  return getDirectoryStatus(path).kind === 'directory';
}
