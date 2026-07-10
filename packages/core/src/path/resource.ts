import { err, ok, type Result } from '@emdash/shared';
import {
  containsAbsolute,
  formatAbsolute,
  joinAbsolute,
  relativeSegmentsFromAbsolute,
} from './absolute';
import { invalidHostId, type PathError } from './errors';
import {
  formatPortableRelativePath,
  parsePortableRelativePath,
  portableRelativePathParts,
  ROOT_RELATIVE_PATH,
} from './relative';
import type {
  HostAbsolutePath,
  HostFileRef,
  HostId,
  PortableRelativePath,
  ScopedPath,
} from './types';

export const LOCAL_HOST_ID = 'local' as HostId;

const HOST_ID_PATTERN = /^[A-Za-z0-9._~-]+$/u;

export function hostId(input: string): Result<HostId, PathError> {
  if (!input) return err(invalidHostId(input, 'Host id must not be empty'));
  if (input.includes('\0')) return err(invalidHostId(input, 'Host id contains a null byte'));
  if (!HOST_ID_PATTERN.test(input)) {
    return err(invalidHostId(input, 'Host id must be URL-safe'));
  }
  return ok(input as HostId);
}

export function unsafeHostId(input: string): HostId {
  return input as HostId;
}

export function isHostId(input: string): input is HostId {
  return hostId(input).success;
}

export function hostIdEquals(a: HostId, b: HostId): boolean {
  return a === b;
}

export function hostFileRef(host: HostId, path: HostAbsolutePath): HostFileRef {
  return { hostId: host, path };
}

export function scopedPath(root: HostFileRef, relative: PortableRelativePath): ScopedPath {
  return { root, relative };
}

export function resolveScopedPath(scoped: ScopedPath): Result<HostFileRef, PathError> {
  const parts = portableRelativePathParts(scoped.relative);
  const path = joinAbsolute(scoped.root.path, ...parts);
  if (!path.success) return path;
  return ok(hostFileRef(scoped.root.hostId, path.data));
}

export function relativizeHostFileRef(
  root: HostFileRef,
  candidate: HostFileRef
): Result<PortableRelativePath, PathError> {
  if (!hostIdEquals(root.hostId, candidate.hostId)) {
    return err({
      type: 'outside-root',
      input: formatHostFileRef(candidate),
      root: formatHostFileRef(root),
      message: 'File refs are on different hosts',
    });
  }
  const segments = relativeSegmentsFromAbsolute(root.path, candidate.path);
  if (!segments.success) return segments;
  return parsePortableRelativePath(segments.data.join('/'));
}

export function containsHostFileRef(root: HostFileRef, candidate: HostFileRef): boolean {
  return hostIdEquals(root.hostId, candidate.hostId) && containsAbsolute(root.path, candidate.path);
}

export function formatHostFileRef(ref: HostFileRef): string {
  return `${ref.hostId}:${formatAbsolute(ref.path)}`;
}

export function rootScopedPath(root: HostFileRef): ScopedPath {
  return scopedPath(root, ROOT_RELATIVE_PATH);
}

export function formatScopedPath(scoped: ScopedPath): string {
  const relative = formatPortableRelativePath(scoped.relative);
  return relative
    ? `${formatHostFileRef(scoped.root)}#${relative}`
    : formatHostFileRef(scoped.root);
}
