import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { FsError } from '@emdash/core/files';
import { err, ok, type Result } from '@emdash/shared';
import { toFsError } from '../api/errors';

export type ResolvedEntryPath = {
  path: string;
  absolutePath: string;
};

export type ResolvedFollowedPath = ResolvedEntryPath & {
  realPath: string;
};

export type ResolvedExistingEntryPath = ResolvedEntryPath & {
  realParentPath: string;
};

export type ResolvedDestinationPath = ResolvedEntryPath & {
  canonicalParent: string;
};

export class RootPathPolicy {
  constructor(readonly rootPath: string) {}

  resolveEntry(entryPath: string): Result<ResolvedEntryPath, FsError> {
    const normalized = normalizeRelativePath(entryPath);
    if (!normalized.success) return normalized;
    const absolutePath = path.resolve(this.rootPath, ...normalized.data.split('/').filter(Boolean));
    if (!containsPath(this.rootPath, absolutePath)) {
      return err(invalidPath(entryPath, 'Path resolves outside the workspace root'));
    }
    return ok({ path: normalized.data, absolutePath });
  }

  async resolveFollowed(entryPath: string): Promise<Result<ResolvedFollowedPath, FsError>> {
    const entry = this.resolveEntry(entryPath);
    if (!entry.success) return entry;
    try {
      const canonical = await realpath(entry.data.absolutePath);
      if (!containsPath(this.rootPath, canonical)) {
        return err(invalidPath(entry.data.path, 'Path resolves outside the workspace root'));
      }
      return ok({ ...entry.data, realPath: canonical });
    } catch (error) {
      return err(toFsError(error, entry.data.path));
    }
  }

  async resolveExistingEntry(
    entryPath: string
  ): Promise<Result<ResolvedExistingEntryPath, FsError>> {
    const entry = this.resolveEntry(entryPath);
    if (!entry.success) return entry;
    try {
      await lstat(entry.data.absolutePath);
      const realParentPath =
        entry.data.path === ''
          ? this.rootPath
          : await realpath(path.dirname(entry.data.absolutePath));
      if (!containsPath(this.rootPath, realParentPath)) {
        return err(
          invalidPath(entry.data.path, 'Entry parent resolves outside the workspace root')
        );
      }
      return ok({ ...entry.data, realParentPath });
    } catch (error) {
      return err(toFsError(error, entry.data.path));
    }
  }

  async resolveDestination(entryPath: string): Promise<Result<ResolvedDestinationPath, FsError>> {
    const entry = this.resolveEntry(entryPath);
    if (!entry.success) return entry;
    if (entry.data.path === '') {
      return err(invalidPath(entryPath, 'The workspace root is not a valid destination'));
    }

    let ancestor = path.dirname(entry.data.absolutePath);
    for (;;) {
      try {
        await lstat(ancestor);
        const canonicalParent = await realpath(ancestor);
        if (!containsPath(this.rootPath, canonicalParent)) {
          return err(invalidPath(entry.data.path, 'Destination parent resolves outside the root'));
        }
        return ok({ ...entry.data, canonicalParent });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          return err(toFsError(error, entry.data.path));
        }
        const parent = path.dirname(ancestor);
        if (parent === ancestor || !containsPath(this.rootPath, parent)) {
          return err(invalidPath(entry.data.path, 'Destination has no parent inside the root'));
        }
        ancestor = parent;
      }
    }
  }

  toRelative(absolutePath: string): string | null {
    const relative = path.relative(this.rootPath, path.resolve(absolutePath));
    if (relative === '') return '';
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return null;
    }
    return relative.split(path.sep).join('/');
  }
}

export function normalizeRelativePath(input: string): Result<string, FsError> {
  if (input.includes('\0')) return err(invalidPath(input, 'Path contains a NUL byte'));
  if (input.includes('\\')) return err(invalidPath(input, 'Path must use POSIX separators'));
  if (input.startsWith('/') || path.win32.isAbsolute(input) || /^[A-Za-z]:/.test(input)) {
    return err(invalidPath(input, 'Path must be relative to the workspace root'));
  }
  if (input.endsWith('/')) return err(invalidPath(input, 'Path must not end with a separator'));

  const segments = input.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..' || segment === '')) {
    if (input === '') return ok('');
    return err(invalidPath(input, 'Path contains an invalid segment'));
  }
  return ok(input);
}

export function containsPath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function invalidPath(entryPath: string, message: string): FsError {
  return { type: 'invalid-path', path: entryPath, message };
}
