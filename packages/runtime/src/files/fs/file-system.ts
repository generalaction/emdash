import { constants } from 'node:fs';
import { cp, lstat, mkdir, open, rename, rm, rmdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type {
  CopyInput,
  CreateDirectoryInput,
  CreateFileInput,
  DeleteInput,
  FileStat,
  FsError,
  MoveInput,
  PathBatch,
  PathKey,
  PathList,
  ReadBytesMeta,
  ReadFileOptions,
  ReadTextResult,
  RenameInput,
  WriteFileInput,
} from '@emdash/core/files';
import { err, ok, type Result } from '@emdash/shared';
import type { BlobSource, LiveJobContext } from '@emdash/wire';
import { globIterate } from 'glob';
import type { FilesAllocationGraph } from '../allocation/allocation-graph';
import { expectedFsError, toFsError } from '../api/errors';
import type { RootResource } from '../root/root-resource';
import { enumerateFiles } from './enumerate';
import { etagForStat, mimeTypeForPath, normalizeMaxBytes } from './metadata';

const STREAM_CHUNK_SIZE = 64 * 1024;
const PROGRESS_BATCH_SIZE = 100;

export class FileSystemRuntime {
  constructor(private readonly allocations: FilesAllocationGraph) {}

  stat(input: PathKey): Promise<Result<FileStat, FsError>> {
    return this.run(input.rootPath, async (root) => {
      const resolved = await root.paths.resolveFollowed(input.path);
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

  exists(input: PathKey): Promise<Result<boolean, FsError>> {
    return this.run(input.rootPath, async (root) => {
      const resolved = await root.paths.resolveFollowed(input.path);
      if (resolved.success) return ok(true);
      return resolved.error.type === 'not-found' ? ok(false) : resolved;
    });
  }

  realPath(input: PathKey): Promise<Result<string, FsError>> {
    return this.run(input.rootPath, async (root) => {
      const resolved = await root.paths.resolveFollowed(input.path);
      return resolved.success ? ok(resolved.data.realPath) : resolved;
    });
  }

  readText(
    input: PathKey & { options?: ReadFileOptions }
  ): Promise<Result<ReadTextResult, FsError>> {
    return this.run(input.rootPath, async (root) => {
      const resolved = await root.paths.resolveFollowed(input.path);
      if (!resolved.success) return resolved;
      try {
        const handle = await open(
          resolved.data.realPath,
          constants.O_RDONLY | constants.O_NONBLOCK
        );
        try {
          const metadata = await handle.stat();
          if (metadata.isDirectory()) return err({ type: 'is-a-directory', path: input.path });
          if (!metadata.isFile()) return err(notRegularFile(input.path));
          const readSize = Math.min(metadata.size, normalizeMaxBytes(input.options?.maxBytes));
          const buffer = Buffer.alloc(readSize);
          const { bytesRead } =
            readSize === 0 ? { bytesRead: 0 } : await handle.read(buffer, 0, readSize, 0);
          return ok({
            content: buffer.subarray(0, bytesRead).toString('utf8'),
            truncated: metadata.size > bytesRead,
            totalSize: metadata.size,
            etag: etagForStat(metadata),
          });
        } finally {
          await handle.close();
        }
      } catch (error) {
        return err(toFsError(error, input.path));
      }
    });
  }

  readBytes(
    input: PathKey & { options?: ReadFileOptions }
  ): Promise<Result<{ meta: ReadBytesMeta; source: BlobSource }, FsError>> {
    return this.run(input.rootPath, async (root) => {
      const resolved = await root.paths.resolveFollowed(input.path);
      if (!resolved.success) return resolved;
      let handle;
      try {
        handle = await open(resolved.data.realPath, constants.O_RDONLY | constants.O_NONBLOCK);
        const metadata = await handle.stat();
        if (metadata.isDirectory()) {
          await handle.close();
          return err({ type: 'is-a-directory', path: input.path });
        }
        if (!metadata.isFile()) {
          await handle.close();
          return err(notRegularFile(input.path));
        }
        const readSize = Math.min(metadata.size, normalizeMaxBytes(input.options?.maxBytes));
        return ok({
          meta: {
            name: path.basename(input.path) || path.basename(resolved.data.realPath),
            mimeType: mimeTypeForPath(input.path) ?? 'application/octet-stream',
            size: readSize,
            lastModified: metadata.mtimeMs,
            truncated: metadata.size > readSize,
            totalSize: metadata.size,
            etag: etagForStat(metadata),
          },
          source: fileBlobSource(handle, readSize),
        });
      } catch (error) {
        await handle?.close().catch(() => {});
        return err(toFsError(error, input.path));
      }
    });
  }

  glob(
    input: { rootPath: string; patterns: string[]; options: { cwd: string; dot?: boolean } },
    context: LiveJobContext<PathBatch>
  ): Promise<Result<PathList, FsError>> {
    return this.run(input.rootPath, async (root) => {
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
        const paths: string[] = [];
        const pending: string[] = [];
        for await (const match of globIterate(input.patterns, {
          absolute: false,
          cwd: cwd.data.realPath,
          dot: input.options.dot ?? false,
          follow: false,
        })) {
          if (context.signal.aborted) break;
          if (typeof match !== 'string') continue;
          const matchPath = match.split(path.sep).join('/');
          const relative = input.options.cwd ? `${input.options.cwd}/${matchPath}` : matchPath;
          paths.push(relative);
          pending.push(relative);
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
    return this.run(input.rootPath, (root) =>
      enumerateFiles(root, input.path, input.options ?? {}, context)
    );
  }

  createFile(input: CreateFileInput): Promise<Result<void, FsError>> {
    return this.mutate(input.rootPath, async (root) => {
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
    return this.mutate(input.rootPath, async (root) => {
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
    return this.mutate(input.rootPath, async (root) => {
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
    return this.mutate(input.rootPath, async (root) => {
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
    return this.mutate(input.rootPath, async (root) => {
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
    return this.mutate(input.rootPath, async (root) => {
      const target = await root.paths.resolveFollowed(input.path);
      if (!target.success) return target;
      try {
        const metadata = await stat(target.data.realPath);
        if (metadata.isDirectory()) return err({ type: 'is-a-directory', path: target.data.path });
        if (!metadata.isFile()) return err(notRegularFile(target.data.path));
        const handle = await open(target.data.realPath, constants.O_WRONLY | constants.O_NONBLOCK);
        try {
          if (!(await handle.stat()).isFile()) return err(notRegularFile(target.data.path));
          await handle.truncate(0);
          await handle.writeFile(Buffer.from(input.content, input.encoding ?? 'utf8'));
        } finally {
          await handle.close();
        }
        this.allocations.notifyActiveRoot(root, [{ kind: 'update', path: target.data.path }]);
        return ok<void>();
      } catch (error) {
        return err(toFsError(error, target.data.path));
      }
    });
  }

  private run<T>(
    rootPath: string,
    operation: (root: RootResource) => Promise<Result<T, FsError>>
  ): Promise<Result<T, FsError>> {
    return this.withExpectedErrors(() => this.allocations.useRoot(rootPath, operation));
  }

  private mutate(
    rootPath: string,
    operation: (root: RootResource) => Promise<Result<void, FsError>>
  ): Promise<Result<void, FsError>> {
    return this.withExpectedErrors(() => this.allocations.useRoot(rootPath, operation));
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

function fileBlobSource(
  handle: Awaited<ReturnType<typeof open>>,
  totalBytes: number
): AsyncIterable<Uint8Array> {
  let position = 0;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await handle.close();
  };
  return {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<Uint8Array>> {
          if (closed || position >= totalBytes) {
            await close();
            return { done: true, value: undefined };
          }
          const size = Math.min(STREAM_CHUNK_SIZE, totalBytes - position);
          const buffer = Buffer.alloc(size);
          let bytesRead: number;
          try {
            ({ bytesRead } = await handle.read(buffer, 0, size, position));
          } catch (error) {
            await close();
            throw error;
          }
          position += bytesRead;
          if (bytesRead === 0) {
            await close();
            return { done: true, value: undefined };
          }
          return { done: false, value: buffer.subarray(0, bytesRead) };
        },
        async return(): Promise<IteratorResult<Uint8Array>> {
          await close();
          return { done: true, value: undefined };
        },
      };
    },
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
