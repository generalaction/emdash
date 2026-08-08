import { constants } from 'node:fs';
import { lstat, open, stat } from 'node:fs/promises';
import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import type { LiveJobContext } from '@emdash/wire/live';
import type { BlobSource, WireFile } from '@emdash/wire/rpc';
import {
  formatAbsolute,
  parseAbsolute,
  type HostAbsolutePath,
  type PortableRelativePath,
} from '#primitives/path/api';
import type {
  CreateDirectoryInput,
  DeleteInput,
  FileKey,
  FileStat,
  FsError,
  MutationTarget,
  PathBatch,
  PathKey,
  PathList,
  ReadBytesMeta,
  ReadFileOptions,
  ReadTextResult,
  RootKey,
  UploadFileInput,
  UploadFileResult,
  WriteFileInput,
} from '#runtimes/files/api';
import type { FilesAllocationGraph } from '#runtimes/files/node/allocation/allocation-graph';
import { expectedFsError, toFsError } from '#runtimes/files/node/api/errors';
import type { RootChange, RootResource } from '#runtimes/files/node/root/root-resource';
import { enumerateFiles } from './enumerate';
import { mimeTypeForPath, normalizeMaxBytes, readStrongSnapshot } from './metadata';
import { createDirectoryInRoot, deleteInRoot } from './mutation-ops';
import { writeFileContent } from './write-file';

const STREAM_CHUNK_SIZE = 64 * 1024;

export class FileSystemRuntime {
  constructor(private readonly allocations: FilesAllocationGraph) {}

  stat(input: PathKey): Promise<Result<FileStat, FsError>> {
    return this.run(input.root, async (root) => {
      const resolved = await root.paths.resolveFollowed(input.relative);
      if (!resolved.success) return resolved;
      try {
        const metadata = await stat(resolved.data.realPath);
        if (!metadata.isDirectory() && !metadata.isFile()) {
          return err(notRegularFile(resolved.data.path));
        }
        return ok({
          path: resolved.data.path,
          type: metadata.isDirectory() ? 'directory' : 'file',
          size: metadata.size,
          mtimeMs: metadata.mtimeMs,
          ctimeMs: metadata.ctimeMs,
          mode: metadata.mode,
        });
      } catch (error) {
        return err(toFsError(error, resolved.data.path));
      }
    });
  }

  async exists(input: FileKey): Promise<Result<boolean, FsError>> {
    const result = await this.runAt(input, async (root, relative) => {
      const resolved = await root.paths.resolveFollowed(relative);
      if (resolved.success) return ok(true);
      return resolved.error.type === 'not-found' ? ok(false) : resolved;
    });
    // For a bare absolute path, a missing parent directory means the file does
    // not exist rather than an addressing failure.
    if (!result.success && result.error.type === 'not-found' && 'path' in input) return ok(false);
    return result;
  }

  realPath(input: FileKey): Promise<Result<HostAbsolutePath, FsError>> {
    return this.runAt(input, async (root, relative) => {
      const resolved = await root.paths.resolveFollowed(relative);
      if (!resolved.success) return resolved;
      const parsed = parseAbsolute(resolved.data.realPath, {
        profile: {
          style: path.sep === '\\' ? 'win32' : 'posix',
          unicodeNormalization: 'preserve',
        },
      });
      return parsed.success
        ? ok(parsed.data)
        : err({ type: 'invalid-path', path: relative, message: parsed.error.message });
    });
  }

  readText(
    input: FileKey & { options?: ReadFileOptions }
  ): Promise<Result<ReadTextResult, FsError>> {
    return this.runAt(input, async (root, relative) => {
      const resolved = await root.paths.resolveFollowed(relative);
      if (!resolved.success) return resolved;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const handle = await open(
            resolved.data.realPath,
            constants.O_RDONLY | constants.O_NONBLOCK
          );
          try {
            const before = await handle.stat();
            if (before.isDirectory()) return err({ type: 'is-a-directory', path: relative });
            if (!before.isFile()) return err(notRegularFile(relative));
            const readSize = Math.min(before.size, normalizeMaxBytes(input.options?.maxBytes));
            const snapshot = await readStrongSnapshot(handle, before.size, readSize);
            const after = await handle.stat();
            if (!sameFileVersion(before, after)) {
              if (attempt === 0) continue;
              return err(changedWhileReading(relative));
            }
            return ok({
              content: snapshot.bytes.toString('utf8'),
              truncated: after.size > snapshot.bytes.length,
              totalSize: after.size,
              etag: snapshot.etag,
            });
          } finally {
            await handle.close();
          }
        } catch (error) {
          return err(toFsError(error, relative));
        }
      }
      throw new Error('readText exhausted its read attempts');
    });
  }

  readBytes(
    input: FileKey & { options?: ReadFileOptions }
  ): Promise<Result<{ meta: ReadBytesMeta; source: BlobSource }, FsError>> {
    return this.runAt(input, async (root, relative) => {
      const resolved = await root.paths.resolveFollowed(relative);
      if (!resolved.success) return resolved;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const handle = await open(
            resolved.data.realPath,
            constants.O_RDONLY | constants.O_NONBLOCK
          );
          let result: { meta: ReadBytesMeta; source: BlobSource } | undefined;
          try {
            const before = await handle.stat();
            if (before.isDirectory()) {
              return err({ type: 'is-a-directory', path: relative });
            }
            if (!before.isFile()) return err(notRegularFile(relative));
            const readSize = Math.min(before.size, normalizeMaxBytes(input.options?.maxBytes));
            const snapshot = await readStrongSnapshot(handle, before.size, readSize);
            const after = await handle.stat();
            if (!sameFileVersion(before, after)) {
              if (attempt === 0) continue;
              return err(changedWhileReading(relative));
            }
            result = {
              meta: {
                name: path.basename(relative) || path.basename(resolved.data.realPath),
                mimeType: mimeTypeForPath(relative) ?? 'application/octet-stream',
                size: snapshot.bytes.length,
                lastModified: after.mtimeMs,
                truncated: after.size > snapshot.bytes.length,
                totalSize: after.size,
                etag: snapshot.etag,
              },
              source: bufferBlobSource(snapshot.bytes),
            };
          } finally {
            await handle.close();
          }
          if (result) return ok(result);
        } catch (error) {
          return err(toFsError(error, relative));
        }
      }
      throw new Error('readBytes exhausted its read attempts');
    });
  }

  async upload(input: UploadFileInput, file: WireFile): Promise<Result<UploadFileResult, FsError>> {
    const key = mutationFileKey(input.root, input.path);
    if (!key.success) return key;

    let bytes: Uint8Array;
    try {
      bytes = await file.bytes();
    } catch (error) {
      return err(toFsError(error, formatMutationTarget(input.path)));
    }

    return this.runAt(key.data, async (root, relative) => {
      const destination = await root.paths.resolveDestination(relative);
      if (!destination.success) return destination;

      return root.runFileMutation(destination.data.absolutePath, async () => {
        let existed = false;
        try {
          const metadata = await lstat(destination.data.absolutePath).catch((error: unknown) => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw error;
          });
          existed = metadata !== null;
          if (metadata?.isDirectory()) {
            return err({ type: 'is-a-directory', path: destination.data.path });
          }
          if (metadata?.isSymbolicLink()) {
            return err({
              type: 'invalid-path',
              path: destination.data.path,
              message: 'Upload destination must not be a symbolic link',
            });
          }
          if (existed && !input.overwrite) {
            return err({ type: 'already-exists', path: destination.data.path });
          }

          const flags = input.overwrite
            ? constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW
            : constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL;
          const handle = await open(destination.data.absolutePath, flags, 0o666);
          try {
            await handle.writeFile(bytes);
          } finally {
            await handle.close();
          }
          this.allocations.notifyActiveRoot(root, [
            { kind: existed ? 'update' : 'create', path: destination.data.path },
          ]);
          return ok({ bytesWritten: bytes.byteLength });
        } catch (error) {
          return err(toFsError(error, destination.data.path));
        }
      });
    });
  }

  enumerate(
    input: PathKey & { options?: { includeSymlinkFiles?: boolean } },
    context: LiveJobContext<PathBatch>
  ): Promise<Result<PathList, FsError>> {
    return this.run(input.root, (root) =>
      enumerateFiles(root, input.relative, input.options ?? {}, context)
    );
  }

  createDirectory(input: CreateDirectoryInput): Promise<Result<void, FsError>> {
    return this.mutateEntry(input.root, input.path, (root, relative) =>
      createDirectoryInRoot(root, { path: relative })
    );
  }

  delete(input: DeleteInput): Promise<Result<void, FsError>> {
    return this.mutateEntry(input.root, input.path, (root, relative) =>
      deleteInRoot(root, { path: relative, recursive: input.recursive })
    );
  }

  writeFile(input: WriteFileInput): Promise<Result<void, FsError>> {
    return this.mutate(input.root, async (root) => {
      return writeFileContent(
        root,
        input.path,
        Buffer.from(input.content, input.encoding ?? 'utf8'),
        input.precondition
      );
    });
  }

  private run<T>(
    root: RootKey['root'],
    operation: (root: RootResource) => Promise<Result<T, FsError>>
  ): Promise<Result<T, FsError>> {
    return this.withExpectedErrors(() => this.allocations.useRoot({ root }, operation));
  }

  private runAt<T>(
    key: FileKey,
    operation: (root: RootResource, relative: PortableRelativePath) => Promise<Result<T, FsError>>
  ): Promise<Result<T, FsError>> {
    return this.withExpectedErrors(() => this.allocations.useFileLocation(key, operation));
  }

  private mutate(
    root: RootKey['root'],
    operation: (root: RootResource) => Promise<Result<void, FsError>>
  ): Promise<Result<void, FsError>> {
    return this.withExpectedErrors(() => this.allocations.useRoot({ root }, operation));
  }

  /**
   * Runs a single-target mutation in the operational root the target resolves
   * to — the given root for root-scoped targets, the entry's parent directory
   * for bare absolute targets — and publishes the resulting changes to it.
   */
  private mutateEntry(
    root: HostAbsolutePath | undefined,
    target: MutationTarget,
    operation: (
      root: RootResource,
      relative: PortableRelativePath
    ) => Promise<Result<RootChange[], FsError>>
  ): Promise<Result<void, FsError>> {
    const key = mutationFileKey(root, target);
    if (!key.success) return Promise.resolve(key);
    return this.runAt(key.data, async (rootResource, relative) => {
      const result = await operation(rootResource, relative);
      if (!result.success) return result;
      this.allocations.notifyActiveRoot(rootResource, result.data);
      return ok<void>();
    });
  }

  private async withExpectedErrors<T>(
    operation: () => Promise<Result<T, FsError>>
  ): Promise<Result<T, FsError>> {
    try {
      return await operation();
    } catch (error) {
      const expected = expectedFsError(error);
      if (expected) return err(expected);
      throw error;
    }
  }
}

function bufferBlobSource(bytes: Buffer): AsyncIterable<Uint8Array> {
  let position = 0;
  return {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<Uint8Array>> {
          if (position >= bytes.length) return { done: true, value: undefined };
          const end = Math.min(position + STREAM_CHUNK_SIZE, bytes.length);
          const value = bytes.subarray(position, end);
          position = end;
          return { done: false, value };
        },
      };
    },
  };
}

function sameFileVersion(
  before: { size: number; mtimeMs: number; ctimeMs: number },
  after: { size: number; mtimeMs: number; ctimeMs: number }
): boolean {
  return (
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs
  );
}

function isAbsoluteTarget(target: MutationTarget): target is HostAbsolutePath {
  return typeof target !== 'string';
}

function formatMutationTarget(target: MutationTarget): string {
  return isAbsoluteTarget(target) ? formatAbsolute(target) : target;
}

/**
 * Normalizes a mutation target into a file key: root-relative when the input
 * carries an operational root, a bare absolute path otherwise. Mode mismatches
 * (a root with an absolute target, or a bare relative target) are addressing
 * errors, mirroring the fileKeySchema duality the read path already serves.
 */
function mutationFileKey(
  root: HostAbsolutePath | undefined,
  target: MutationTarget
): Result<FileKey, FsError> {
  if (root !== undefined) {
    if (isAbsoluteTarget(target)) {
      return err({
        type: 'invalid-path',
        path: formatAbsolute(target),
        message: 'A root-scoped mutation target must be a root-relative path',
      });
    }
    return ok({ root, relative: target });
  }
  if (!isAbsoluteTarget(target)) {
    return err({
      type: 'invalid-path',
      path: target,
      message: 'A mutation without a root must target an absolute path',
    });
  }
  return ok({ path: target });
}

function changedWhileReading(entryPath: PortableRelativePath): FsError {
  return {
    type: 'io',
    path: entryPath,
    message: 'File changed repeatedly while it was being read',
  };
}

function notRegularFile(entryPath: string): FsError {
  return {
    type: 'invalid-path',
    path: entryPath,
    message: 'Path is not a regular file or directory',
  };
}
