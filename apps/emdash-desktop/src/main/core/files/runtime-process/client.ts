import path from 'node:path';
import type { FsError } from '@emdash/core/files';
import type { HostAbsolutePath, PortableRelativePath } from '@emdash/core/path';
import { err, ok, type Result } from '@emdash/shared';
import {
  createLiveJobReplica,
  LiveJobFailedError,
  type JobError,
  type JobInput,
  type JobProgress,
  type JobResult,
  type LiveJobClientHandle,
  type LiveJobEndpointDef,
} from '@emdash/wire';
import {
  hostPathFromNative,
  nativePathFromHost,
  portablePath,
  relativePathWithin,
  resolveRelativePath,
} from '@shared/core/runtime/paths';
import type { FilesRuntimeClient } from './host';

export type FilesClientScope = {
  client: FilesRuntimeClient;
  root: HostAbsolutePath;
};

export type FileExclusionPredicate = (absolutePath: string) => boolean;

export function filesClientScope(client: FilesRuntimeClient, rootPath: string): FilesClientScope {
  const resolvedRoot = path.resolve(rootPath);
  return { client, root: hostPathFromNative(resolvedRoot) };
}

export function fileRelativePath(
  scope: Pick<FilesClientScope, 'root'>,
  targetPath: string
): PortableRelativePath {
  return relativePathWithin(scope.root, hostPathFromNative(path.resolve(targetPath)));
}

export function fileKey(scope: FilesClientScope, targetPath: string) {
  return { root: scope.root, relative: fileRelativePath(scope, targetPath) };
}

export function fileMutationKey(scope: FilesClientScope, targetPath: string) {
  return { root: scope.root, path: fileRelativePath(scope, targetPath) };
}

export function nativeFilePath(scope: FilesClientScope, relative: PortableRelativePath): string {
  return nativePathFromHost(resolveRelativePath(scope.root, relative));
}

export function parentFilePaths(relative: PortableRelativePath): PortableRelativePath[] {
  const parts = relative.split('/');
  return parts.map((_, index) => portablePath(parts.slice(0, index + 1).join('/')));
}

export async function runFilesJob<Def extends LiveJobEndpointDef>(
  definition: Def,
  handle: LiveJobClientHandle<Def>,
  input: JobInput<Def>,
  onProgress?: (progress: JobProgress<Def>) => void
): Promise<Result<JobResult<Def>, JobError<Def>>> {
  const jobs = createLiveJobReplica(definition, handle);
  const lease = await jobs.start(input);
  try {
    const job = await lease.ready();
    const unsubscribe = onProgress ? job.onProgress(onProgress) : undefined;
    try {
      return ok(await job.result);
    } catch (error) {
      if (error instanceof LiveJobFailedError) return err(error.error as JobError<Def>);
      throw error;
    } finally {
      unsubscribe?.();
    }
  } finally {
    await lease.release();
    await jobs.dispose();
  }
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
