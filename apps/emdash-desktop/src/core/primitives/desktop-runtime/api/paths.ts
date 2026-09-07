import { LOCAL_HOST_REF, hostRef } from '@emdash/core/primitives/host/api';
import {
  absoluteDirname,
  createPathSemantics,
  formatAbsolute,
  hostFileRef,
  joinAbsolute,
  parseNativeAbsolute,
  parsePortableRelativePath,
  relativeSegmentsFromAbsolute,
  type HostAbsolutePath,
  type HostFileRef,
  type PathProfile,
  type PortableRelativePath,
} from '@emdash/core/primitives/path/api';

export function hostPathFromNative(input: string): HostAbsolutePath {
  const parsed = parseNativeAbsolute(input);
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
}

export function nativePathFromHost(path: HostAbsolutePath): string {
  return formatAbsolute(path, { separator: path.root.kind === 'posix' ? '/' : '\\' });
}

/** Joins a host path without consulting the desktop process's path dialect. */
export function joinHostPath(base: string, ...segments: string[]): string {
  const joined = joinAbsolute(hostPathFromNative(base), ...segments);
  if (!joined.success) throw new Error(joined.error.message);
  return nativePathFromHost(joined.data);
}

/** Returns a host path's parent using the path's own root dialect. */
export function dirnameHostPath(input: string): string {
  const path = hostPathFromNative(input);
  return nativePathFromHost(absoluteDirname(path) ?? path);
}

export function hostFileRefFromNativePath(path: string, connectionId?: string): HostFileRef {
  const host = connectionId ? hostRef('remote', connectionId) : LOCAL_HOST_REF;
  return hostFileRef(host, hostPathFromNative(path));
}

export function portablePath(input: string): PortableRelativePath {
  const parsed = parsePortableRelativePath(input, { unicodeNormalization: 'preserve' });
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
}

/** The files runtime `fs` surface is keyed by bare host-absolute paths (spec §3.4). */
export function fileKeyForAbsolutePath(path: HostAbsolutePath): { path: HostAbsolutePath } {
  return { path };
}

export function relativePathWithin(
  root: HostAbsolutePath,
  candidate: HostAbsolutePath,
  profile?: PathProfile
): PortableRelativePath {
  if (profile) {
    const semantics = createPathSemantics(profile);
    const rootOnly: HostAbsolutePath = { root: root.root, segments: [] };
    const candidateRootOnly: HostAbsolutePath = { root: candidate.root, segments: [] };
    if (!semantics.equals(rootOnly, candidateRootOnly)) {
      throw new Error('Path roots are not compatible');
    }
    if (!semantics.contains(root, candidate)) {
      throw new Error('Path is outside root');
    }
    return portablePath(candidate.segments.slice(root.segments.length).join('/'));
  }
  const relative = relativeSegmentsFromAbsolute(root, candidate);
  if (!relative.success) throw new Error(relative.error.message);
  return portablePath(relative.data.join('/'));
}

export function resolveRelativePath(
  root: HostAbsolutePath,
  relative: PortableRelativePath
): HostAbsolutePath {
  const resolved = joinAbsolute(root, relative);
  if (!resolved.success) throw new Error(resolved.error.message);
  return resolved.data;
}

export function relativeRuntimePath(root: HostAbsolutePath, input: string): PortableRelativePath {
  if (input.startsWith('/') || isWindowsAbsolute(input)) {
    return relativePathWithin(root, hostPathFromNative(input));
  }
  return portablePath(input.replaceAll('\\', '/'));
}

export function absoluteRuntimePath(root: HostAbsolutePath, input: string): HostAbsolutePath {
  if (input.startsWith('/') || isWindowsAbsolute(input)) return hostPathFromNative(input);
  const separator = root.root.kind === 'posix' ? '/' : '\\';
  const base = nativePathFromHost(root);
  const relative = root.root.kind === 'posix' ? input.replaceAll('\\', '/') : input;
  const combined = base.endsWith(separator)
    ? `${base}${relative}`
    : `${base}${separator}${relative}`;
  return hostPathFromNative(combined);
}

function isWindowsAbsolute(input: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(input) || /^[/\\]{2}[^/\\]+[/\\][^/\\]+/u.test(input);
}
