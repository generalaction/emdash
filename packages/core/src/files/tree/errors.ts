import type { NodeId } from './models/tree';

export type FileTreeOnError = (context: string, error: unknown) => void;

export type FileTreeError =
  | { type: 'invalid-path'; path: string; message: string }
  | { type: 'not-found'; id?: NodeId; path?: string }
  | { type: 'not-directory'; id?: NodeId; path: string }
  | { type: 'fs-error'; path: string; message: string };

export function classifyFileTreeFsError(error: unknown, relPath: string): FileTreeError {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : undefined;
  if (code === 'ENOENT') return { type: 'not-found', path: relPath };
  if (code === 'ENOTDIR') return { type: 'not-directory', path: relPath };
  return { type: 'fs-error', path: relPath, message: String(error) };
}
