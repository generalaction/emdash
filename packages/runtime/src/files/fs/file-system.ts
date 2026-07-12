import { constants } from 'node:fs';
import { cp, lstat, mkdir, open, rename, rm, rmdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type {
  CopyInput,
  CreateDirectoryInput,
  CreateFileInput,
  DeleteInput,
  FileGlobOptions,
  FileStat,
  FileUsage,
  FsError,
  MoveInput,
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
} from '@emdash/core/files';
import {
  joinPortableRelativePath,
  parseAbsolute,
  type HostAbsolutePath,
  type PortableRelativePath,
} from '@emdash/core/path';
import { err, ok, type Result } from '@emdash/shared';
import type { BlobSource, LiveJobContext, WireFile } from '@emdash/wire';
import { globIterate } from 'glob';
import type { FilesAllocationGraph } from '../allocation/allocation-graph';
import { expectedFsError, toFsError } from '../api/errors';
import type { RootResource } from '../root/root-resource';
import { enumerateFiles } from './enumerate';
import { measurePathUsage } from './measure-usage';
import { mimeTypeForPath, normalizeMaxBytes, readStrongSnapshot } from './metadata';
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
    return this.run(input.root, (root) => measurePathUsage(root.paths, input.relative));
  }

  exists(input: PathKey): Promise<Result<boolean, FsError>> {
    return this.run(input.root, async (root) => {
      const resolved = await root.paths.resolveFollowed(input.relative);
      if (resolved.success) return ok(true);
      return resolved.error.type === 'not-found' ? ok(false) : resolved;
    });
  }

  realPath(input: PathKey): Promise<Result<HostAbsolutePath, FsError>> {
    return this.run(input.root, async (root) => {
      const resolved = await root.paths.resolveFollowed(input.relative);
      if (!resolved.success) return resolved;
      const parsed = parseAbsolute(resolved.data.realPath, {
        profile: {
          style: path.sep === '\\' ? 'win32' : 'posix',
          unicodeNormalization: 'preserve',
        },
      });
      return parsed.success
        ? ok(parsed.data)
        : err({ type: 'invalid-path', path: input.relative, message: parsed.error.message });
    });
  }

  readText(
    input: PathKey & { options?: ReadFileOptions }
  ): Promise<Result<ReadTextResult, FsError>> {
    return this.run(input.root, async (root) => {
      const resolved = await root.paths.resolveFollowed(input.relative);
      if (!resolved.success) return resolved;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const handle = await open(
            resolved.data.realPath,
            constants.O_RDONLY | constants.O_NONBLOCK
          );
          try {
            const before = await handle.stat();
            if (before.isDirectory()) return err({ type: 'is-a-directory', path: input.relative });
            if (!before.isFile()) return err(notRegularFile(input.relative));
            const readSize = Math.min(before.size, normalizeMaxBytes(input.options?.maxBytes));
            const snapshot = await readStrongSnapshot(handle, before.size, readSize);
            const after = await handle.stat();
            if (!sameFileVersion(before, after)) {
              if (attempt === 0) continue;
              return err(changedWhileReading(input.relative));
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
          return err(toFsError(error, input.relative));
        }
      }
      throw new Error('readText exhausted its read attempts');
    });
  }

  readBytes(
    input: PathKey & { options?: ReadFileOptions }
  ): Promise<Result<{ meta: ReadBytesMeta; source: BlobSource }, FsError>> {
    return this.run(input.root, async (root) => {
      const resolved = await root.paths.resolveFollowed(input.relative);
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
              return err({ type: 'is-a-directory', path: input.relative });
            }
            if (!before.isFile()) return err(notRegularFile(input.relative));
            const readSize = Math.min(before.size, normalizeMaxBytes(input.options?.maxBytes));
            const snapshot = await readStrongSnapshot(handle, before.size, readSize);
            const after = await handle.stat();
            if (!sameFileVersion(before, after)) {
              if (attempt === 0) continue;
              return err(changedWhileReading(input.relative));
            }
            result = {
              meta: {
                name: path.basename(input.relative) || path.basename(resolved.data.realPath),
                mimeType: mimeTypeForPath(input.relative) ?? 'application/octet-stream',
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
          return err(toFsError(error, input.relative));
        }
      }
      throw new Error('readBytes exhausted its read attempts');
    });
  }

  async upload(input: UploadFileInput, file: WireFile): Promise<Result<UploadFileResult, FsError>> {
    let bytes: Uint8Array;
    try {
      bytes = await file.bytes();
    } catch (error) {
      return err(toFsError(error, input.path));
    }

    return this.run(input.root, async (root) => {
      const destination = await root.paths.resolveDestination(input.path);
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
        for await (const match of globIterate(input.patterns, {
          absolute: false,
          cwd: cwd.data.realPath,
          dot: input.options.dot ?? false,
          follow: false,
        })) {
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
    return this.mutate(input.root, async (root) => {
      const destination = await root.paths.resolveDestination(input.path);
      if (!destination.success) return destination;
      try {
        const handle = await open(destination.data.absolutePath, 'wx');
        try {
          if (input.content !== undefined) await handle.writeFile(input.content, 'utf8');
        } finally {
          await handle.close();
        }
        this.allocations.notifyActiveRoot(root, [{ kind: 'create', path: destination.data.path }]);
        return ok<void>();
      } catch (error) {
        return err(toFsError(error, destination.data.path));
      }
    });
  }

  createDirectory(input: CreateDirectoryInput): Promise<Result<void, FsError>> {
    return this.mutate(input.root, async (root) => {
      const destination = await root.paths.resolveDestination(input.path);
      if (!destination.success) return destination;
      try {
        await mkdir(destination.data.absolutePath);
        this.allocations.notifyActiveRoot(root, [{ kind: 'create', path: destination.data.path }]);
        return ok<void>();
      } catch (error) {
        return err(toFsError(error, destination.data.path));
      }
    });
  }

  rename(input: RenameInput): Promise<Result<void, FsError>> {
    if (path.posix.dirname(input.from) !== path.posix.dirname(input.to)) {
      return Promise.resolve(
        err({ type: 'invalid-path', path: input.to, message: 'Rename requires the same parent' })
      );
    }
    return this.move(input);
  }

  move(input: MoveInput): Promise<Result<void, FsError>> {
    return this.mutate(input.root, async (root) => {
      const source = await root.paths.resolveExistingEntry(input.from);
      if (!source.success) return source;
      if (source.data.path === '') {
        return err({
          type: 'invalid-path',
          path: '',
          message: 'The workspace root cannot be moved',
        });
      }
      const destination = await root.paths.resolveDestination(input.to);
      if (!destination.success) return destination;
      const available = await destinationAvailable(
        destination.data.absolutePath,
        destination.data.path
      );
      if (!available.success) return available;
      try {
        await rename(source.data.absolutePath, destination.data.absolutePath);
        this.allocations.notifyActiveRoot(root, [
          { kind: 'delete', path: source.data.path },
          { kind: 'create', path: destination.data.path },
        ]);
        return ok<void>();
      } catch (error) {
        return err(toFsError(error, source.data.path));
      }
    });
  }

  copy(input: CopyInput): Promise<Result<void, FsError>> {
    return this.mutate(input.root, async (root) => {
      const source = await root.paths.resolveExistingEntry(input.from);
      if (!source.success) return source;
      if (source.data.path === '') {
        return err({
          type: 'invalid-path',
          path: '',
          message: 'The workspace root cannot be copied',
        });
      }
      const destination = await root.paths.resolveDestination(input.to);
      if (!destination.success) return destination;
      const available = await destinationAvailable(
        destination.data.absolutePath,
        destination.data.path
      );
      if (!available.success) return available;
      try {
        await cp(source.data.absolutePath, destination.data.absolutePath, {
          recursive: true,
          force: false,
          errorOnExist: true,
          preserveTimestamps: true,
          verbatimSymlinks: true,
        });
        this.allocations.notifyActiveRoot(root, [{ kind: 'create', path: destination.data.path }]);
        return ok<void>();
      } catch (error) {
        return err(toFsError(error, source.data.path));
      }
    });
  }

  delete(input: DeleteInput): Promise<Result<void, FsError>> {
    return this.mutate(input.root, async (root) => {
      const target = await root.paths.resolveExistingEntry(input.path);
      if (!target.success) return target;
      if (target.data.path === '') {
        return err({
          type: 'invalid-path',
          path: '',
          message: 'The workspace root cannot be deleted',
        });
      }
      try {
        const metadata = await lstat(target.data.absolutePath);
        if (metadata.isDirectory()) {
          if (input.recursive) await rm(target.data.absolutePath, { recursive: true });
          else await rmdir(target.data.absolutePath);
        } else {
          await unlink(target.data.absolutePath);
        }
        this.allocations.notifyActiveRoot(root, [{ kind: 'delete', path: target.data.path }]);
        return ok<void>();
      } catch (error) {
        return err(toFsError(error, target.data.path));
      }
    });
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

  private mutate(
    root: RootKey['root'],
    operation: (root: RootResource) => Promise<Result<void, FsError>>
  ): Promise<Result<void, FsError>> {
    return this.withExpectedErrors(() => this.allocations.useRoot({ root }, operation));
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

function changedWhileReading(entryPath: PortableRelativePath): FsError {
  return {
    type: 'io',
    path: entryPath,
    message: 'File changed repeatedly while it was being read',
  };
}

async function destinationAvailable(
  absolutePath: string,
  relativePath: string
): Promise<Result<void, FsError>> {
  try {
    await lstat(absolutePath);
    return err({ type: 'already-exists', path: relativePath });
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? ok<void>()
      : err(toFsError(error, relativePath));
  }
}

function notRegularFile(entryPath: string): FsError {
  return {
    type: 'invalid-path',
    path: entryPath,
    message: 'Path is not a regular file or directory',
  };
}
