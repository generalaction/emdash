import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import type { FileError } from './errors';

export type RelPath = string & { readonly __relPath: unique symbol };

export type ResolvedPath = {
  relPath: RelPath;
  absPath: string;
};

export function normalizeRelPath(
  input: string,
  options: { allowEmpty?: boolean } = {}
): Result<RelPath, FileError> {
  if (input.includes('\0')) {
    return err({ type: 'invalid-path', path: input, message: 'Path contains a null byte' });
  }
  if (path.isAbsolute(input) || path.win32.isAbsolute(input)) {
    return err({ type: 'invalid-path', path: input, message: 'Absolute paths are not allowed' });
  }

  const parts = input
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part.length > 0 && part !== '.');
  if (parts.includes('..')) {
    return err({
      type: 'invalid-path',
      path: input,
      message: 'Parent path segments are not allowed',
    });
  }

  const normalized = parts.join('/');
  if (!normalized && !options.allowEmpty) {
    return err({ type: 'invalid-path', path: input, message: 'Path must not be empty' });
  }
  return ok(normalized as RelPath);
}

export function normalizeRelPaths(
  inputs: readonly string[],
  options: { allowEmpty?: boolean } = {}
): Result<RelPath[], FileError> {
  const normalized = new Set<RelPath>();
  for (const input of inputs) {
    const result = normalizeRelPath(input, options);
    if (!result.success) return result;
    normalized.add(result.data);
  }
  return ok([...normalized]);
}

export function resolveInsideRoot(
  rootPath: string,
  input: string,
  options: { allowEmpty?: boolean } = {}
): Result<ResolvedPath, FileError> {
  const normalized = normalizeRelPath(input, options);
  if (!normalized.success) return normalized;

  const root = path.resolve(rootPath);
  const absPath = path.resolve(root, normalized.data);
  const relativeToRoot = path.relative(root, absPath);
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    return err({ type: 'invalid-path', path: input, message: 'Path escapes the root' });
  }

  return ok({ relPath: normalized.data, absPath });
}

export function parentRelPath(relPath: string): string {
  const index = relPath.lastIndexOf('/');
  return index === -1 ? '' : relPath.slice(0, index);
}

export function basenameFromRelPath(relPath: string): string {
  const index = relPath.lastIndexOf('/');
  return index === -1 ? relPath : relPath.slice(index + 1);
}

export function isRelPathWithinScope(relPath: string, scopePath: string): boolean {
  return scopePath === '' || relPath === scopePath || relPath.startsWith(`${scopePath}/`);
}
