import path from 'node:path';
import type { FileError } from '@emdash/core/files';
import { err, ok, type Result } from '@emdash/shared';
import { isLegacySshIgnoredRelativePath } from './ssh-ignored-paths';

export function normalizeRemoteRootPath(rootPath: string): string {
  const normalized = path.posix.normalize(rootPath.replace(/\\/g, '/'));
  return path.posix.isAbsolute(normalized) ? normalized : path.posix.resolve('/', normalized);
}

export function normalizeRemoteAbsolutePath(value: string | undefined): Result<string, FileError> {
  const raw = value ?? '';
  if (raw.includes('\0')) {
    return err({ type: 'invalid-path', path: raw, message: 'Path contains a null byte' });
  }
  const normalized = path.posix.normalize(raw.replace(/\\/g, '/'));
  if (!path.posix.isAbsolute(normalized)) {
    return err({ type: 'invalid-path', path: raw, message: 'Path must be absolute' });
  }
  return ok(normalized);
}

export function toRemoteAbsolutePath(rootPath: string, value: string): string {
  const normalized = value.replace(/\\/g, '/');
  if (path.posix.isAbsolute(normalized)) return normalizeRemoteRootPath(normalized);
  return normalizeRemoteRootPath(path.posix.join(rootPath, normalized));
}

export function containsRemotePath(parent: string, child: string): boolean {
  const rel = path.posix.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith('../') && !path.posix.isAbsolute(rel));
}

export function isIgnoredRemotePath(rootPath: string, absPath: string): boolean {
  const rel = path.posix.relative(normalizeRemoteRootPath(rootPath), absPath);
  if (!rel || rel === '..' || rel.startsWith('../') || path.posix.isAbsolute(rel)) {
    return false;
  }
  return isLegacySshIgnoredRelativePath(rel);
}
