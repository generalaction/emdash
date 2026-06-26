import fs from 'node:fs';

export type DirectoryStatus =
  | { kind: 'directory' }
  | { kind: 'not-directory' }
  | { kind: 'inspect-failed'; message: string };

export function getDirectoryStatus(path: string): DirectoryStatus {
  try {
    return fs.statSync(path).isDirectory() ? { kind: 'directory' } : { kind: 'not-directory' };
  } catch (error) {
    if (isMissingPathError(error)) return { kind: 'not-directory' };
    return {
      kind: 'inspect-failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function checkIsValidDirectory(path: string): boolean {
  return getDirectoryStatus(path).kind === 'directory';
}

function isMissingPathError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}
