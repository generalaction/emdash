import { constants } from 'node:fs';
import { lstat, open, stat } from 'node:fs/promises';
import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import type { LiveJobContext } from '@emdash/wire/live';
import type { BlobSource, WireFile } from '@emdash/wire/rpc';
import { glob } from 'glob';
import {
  absoluteDirname,
  absoluteEquals,
  formatAbsolute,
  joinPortableRelativePath,
  parseAbsolute,
  type HostAbsolutePath,
  type PortableRelativePath,
} from '#primitives/path/api';
import type {
  CopyInput,
  CreateDirectoryInput,
  CreateFileInput,
  DeleteInput,
  FileGlobOptions,
  FileKey,
  FileStat,
  FileUsage,
  FsError,
  MoveInput,
  MutationTarget,
  PathBatch,
  PathKey,
  PathList,
  ReadBytesMeta,
  ReadFileOptions,
  ReadTextResult,
  RenameInput,
  RootKey,
  UploadFileInput,
  UploadFileResult,
  WriteFileInput,
} from '#runtimes/files/api';
import type { FilesAllocationGraph } from '#runtimes/files/node/allocation/allocation-graph';
import { expectedFsError, toFsError } from '#runtimes/files/node/api/errors';
import type { RootChange, RootResource } from '#runtimes/files/node/root/root-resource';
import { measureAbsolutePathUsage } from '#services/fs-usage/node';
import { enumerateFiles } from './enumerate';
import { mimeTypeForPath, normalizeMaxBytes, readStrongSnapshot } from './metadata';
import {
  copyBetweenRoots,
  createDirectoryInRoot,
  createFileInRoot,
  deleteInRoot,
  moveBetweenRoots,
  type RootLocation,
} from './mutation-ops';
import { writeFileContent } from './write-file';

const STREAM_CHUNK_SIZE = 64 * 1024;
const PROGRESS_BATCH_SIZE = 100;

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

  measureUsage(input: PathKey): Promise<Result<FileUsage, FsError>> {
    return this.run(input.root, async (root) => {
      const resolved = await root.paths.resolveExistingEntry(input.relative);
      if (!resolved.success) return resolved;
      try {
        const usage = await measureAbsolutePathUsage(
          resolved.data.absolutePath,
          resolved.data.path
        );
        return ok({
          ...usage,
          path: resolved.data.path,
          errors: usage.errors.map((error) => ({
            path: error.path as PortableRelativePath,
            message: error.message,
          })),
        });
      } catch (error) {
        return err(toFsError(error, input.relative));
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

  glob(
    input: {
      root: RootKey['root'];
      patterns: string[];
      options: FileGlobOptions;
    },
    context: LiveJobContext<PathBatch>
  ): Promise<Result<PathList, FsError>> {
    return this.run(input.root, async (root) => {
      if (input.patterns.length === 0) {
        return err({ type: 'invalid-path', path: '', message: 'At least one pattern is required' });
      }
      const invalid = input.patterns.find(
        (pattern) =>
          !pattern ||
          pattern.includes('\0') ||
          pattern.includes('\\') ||
          path.posix.isAbsolute(pattern) ||
          pattern.split('/').includes('..')
      );
      if (invalid !== undefined) {
        return err({ type: 'invalid-path', path: invalid, message: 'Invalid glob pattern' });
      }
      const cwd = await root.paths.resolveFollowed(input.options.cwd);
      if (!cwd.success) return cwd;

      try {
        const paths: PortableRelativePath[] = [];
        const pending: PortableRelativePath[] = [];
        const matches = await Promise.all(
          input.patterns.map((pattern) =>
            glob(pattern, {
              absolute: false,
              cwd: cwd.data.realPath,
              dot: input.options.dot ?? false,
              follow: false,
            })
          )
        );
        for (const match of matches.flat()) {
          if (context.signal.aborted) break;
          if (typeof match !== 'string') continue;
          const matchPath = match.split(path.sep).join('/');
          const relative = joinPortableRelativePath(input.options.cwd, matchPath);
          if (!relative.success) continue;
          paths.push(relative.data);
          pending.push(relative.data);
          if (pending.length >= PROGRESS_BATCH_SIZE) {
            context.progress({ paths: pending.splice(0) });
          }
        }
        if (pending.length > 0) context.progress({ paths: pending });
        return ok({ paths });
      } catch (error) {
        return err(toFsError(error, input.options.cwd));
      }
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

  createFile(input: CreateFileInput): Promise<Result<void, FsError>> {
    return this.mutateEntry(input.root, input.path, (root, relative) =>
      createFileInRoot(root, { path: relative, content: input.content })
    );
  }

  createDirectory(input: CreateDirectoryInput): Promise<Result<void, FsError>> {
    return this.mutateEntry(input.root, input.path, (root, relative) =>
      createDirectoryInRoot(root, { path: relative })
    );
  }

  rename(input: RenameInput): Promise<Result<void, FsError>> {
    const guard = sameParentGuard(input);
    if (guard) return Promise.resolve(err(guard));
    return this.move(input);
  }

  move(input: MoveInput): Promise<Result<void, FsError>> {
    return this.mutatePair(input, async (from, to) => {
      const moved = await moveBetweenRoots(from, to);
      if (!moved.success) return moved;
      this.allocations.notifyActiveRoot(from.root, moved.data.source);
      this.allocations.notifyActiveRoot(to.root, moved.data.target);
      return ok<void>();
    });
  }

  copy(input: CopyInput): Promise<Result<void, FsError>> {
    return this.mutatePair(input, async (from, to) => {
      const copied = await copyBetweenRoots(from, to);
      if (!copied.success) return copied;
      this.allocations.notifyActiveRoot(to.root, copied.data.target);
      return ok<void>();
    });
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

  /**
   * Runs a two-endpoint mutation with each endpoint resolved to its own
   * operational root (both endpoints share the given root in root-scoped mode;
   * bare absolute endpoints resolve to their parent directories).
   */
  private mutatePair(
    input: { root?: HostAbsolutePath; from: MutationTarget; to: MutationTarget },
    operation: (from: RootLocation, to: RootLocation) => Promise<Result<void, FsError>>
  ): Promise<Result<void, FsError>> {
    const fromKey = mutationFileKey(input.root, input.from);
    if (!fromKey.success) return Promise.resolve(fromKey);
    const toKey = mutationFileKey(input.root, input.to);
    if (!toKey.success) return Promise.resolve(toKey);
    return this.withExpectedErrors(() =>
      this.allocations.useFileLocation(fromKey.data, (fromRoot, fromRelative) =>
        this.allocations.useFileLocation(toKey.data, (toRoot, toRelative) =>
          operation({ root: fromRoot, path: fromRelative }, { root: toRoot, path: toRelative })
        )
      )
    );
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

/** Rename keeps move semantics plus a same-parent invariant in both modes. */
function sameParentGuard(input: {
  root?: HostAbsolutePath;
  from: MutationTarget;
  to: MutationTarget;
}): FsError | undefined {
  if (input.root !== undefined) {
    if (isAbsoluteTarget(input.from) || isAbsoluteTarget(input.to)) return undefined;
    if (path.posix.dirname(input.from) === path.posix.dirname(input.to)) return undefined;
    return { type: 'invalid-path', path: input.to, message: 'Rename requires the same parent' };
  }
  if (!isAbsoluteTarget(input.from) || !isAbsoluteTarget(input.to)) return undefined;
  const fromParent = absoluteDirname(input.from);
  const toParent = absoluteDirname(input.to);
  if (fromParent && toParent && absoluteEquals(fromParent, toParent)) return undefined;
  return {
    type: 'invalid-path',
    path: formatAbsolute(input.to),
    message: 'Rename requires the same parent',
  };
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
