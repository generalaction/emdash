import {
  createPathProfile,
  type HostAbsolutePath,
  type PathProfile,
  type PortableRelativePath,
} from '@emdash/core/primitives/path/api';
import type { FsError } from '@emdash/core/runtimes/files/api';
import {
  hostPathFromNative,
  nativePathFromHost,
  portablePath,
  relativePathWithin,
  resolveRelativePath,
} from '@core/primitives/desktop-runtime/api';
import type { FilesRuntimeClient } from '../api/clients';

export type FilesClientScope = {
  client: FilesRuntimeClient;
  root: HostAbsolutePath;
  profile: PathProfile;
};

export type FileExclusionPredicate = (absolutePath: string) => boolean;

type HostAbsolutePathInput = string | HostAbsolutePath;

export function filesClientScope(
  client: FilesRuntimeClient,
  rootPath: HostAbsolutePathInput,
  profile?: PathProfile
): FilesClientScope {
  const root = asHostAbsolutePath(rootPath);
  return {
    client,
    root,
    profile:
      profile ?? createPathProfile({ style: root.root.kind === 'posix' ? 'posix' : 'win32' }),
  };
}

export function fileRelativePath(
  scope: Pick<FilesClientScope, 'root' | 'profile'>,
  targetPath: HostAbsolutePathInput
): PortableRelativePath {
  return relativePathWithin(scope.root, asHostAbsolutePath(targetPath), scope.profile);
}

/**
 * The `fs` surface is keyed by host-absolute paths (spec §3.4). Resolving
 * through the scope's root keeps the historical containment check: a target
 * escaping the scope root still throws at this edge.
 */
export function fileKey(
  scope: FilesClientScope,
  targetPath: HostAbsolutePathInput
): { path: HostAbsolutePath } {
  return { path: resolveRelativePath(scope.root, fileRelativePath(scope, targetPath)) };
}

export function nativeFilePath(scope: FilesClientScope, relative: PortableRelativePath): string {
  return nativePathFromHost(resolveRelativePath(scope.root, relative));
}

export function parentFilePaths(relative: PortableRelativePath): PortableRelativePath[] {
  const parts = relative.split('/');
  return parts.map((_, index) => portablePath(parts.slice(0, index + 1).join('/')));
}

export async function* singleFileChunk(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

export function fsErrorMessage(error: FsError): string {
  switch (error.type) {
    case 'invalid-path':
    case 'io':
      return error.message;
    case 'etag-mismatch':
      return `File changed since it was read: ${error.path}`;
    default:
      return `${error.type}: ${error.path}`;
  }
}

export function isFileNotFoundError(error: FsError): boolean {
  return error.type === 'not-found' || error.type === 'not-a-directory';
}

function asHostAbsolutePath(path: HostAbsolutePathInput): HostAbsolutePath {
  return typeof path === 'string' ? hostPathFromNative(path) : path;
}
