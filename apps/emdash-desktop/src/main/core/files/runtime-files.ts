import path from 'node:path';
import type { FileStat as RuntimeFileStat, FsError, ReadFileOptions } from '@emdash/core/files';
import type { PortableRelativePath } from '@emdash/core/path';
import { err, ok, type Result } from '@emdash/shared';
import { createLiveJobReplica, LiveJobFailedError } from '@emdash/wire';
import {
  hostPathFromNative,
  nativePathFromHost,
  portablePath,
  relativePathWithin,
  resolveRelativePath,
} from '@shared/core/runtime/paths';
import { getFilesRuntimeClient, type FilesRuntimeClient } from './runtime-process/host';
import {
  fsErrorMessage,
  type FileExclusionPredicate,
  type FileStat,
  type FileUsage,
  type ReadBytesResult,
  type ReadTextResult,
  type ScopedFileSystem,
  type WriteFileResult,
} from './scoped-file-system';

export class RuntimeFileSystem implements ScopedFileSystem {
  readonly rootPath: string;
  private readonly root;

  constructor(
    rootPath: string,
    private readonly getClient: () => Promise<FilesRuntimeClient> = getFilesRuntimeClient
  ) {
    this.rootPath = path.resolve(rootPath);
    this.root = hostPathFromNative(this.rootPath);
  }

  async readText(
    targetPath: string,
    options?: ReadFileOptions
  ): Promise<Result<ReadTextResult, FsError>> {
    return (await this.getClient()).fs.readText({
      root: this.root,
      relative: this.relative(targetPath),
      options,
    });
  }

  async readBytes(
    targetPath: string,
    options?: ReadFileOptions
  ): Promise<Result<ReadBytesResult, FsError>> {
    const result = await (
      await this.getClient()
    ).fs.readBytes({
      root: this.root,
      relative: this.relative(targetPath),
      options,
    });
    if (!result.success) return result;
    const bytes = await result.data.bytes();
    return ok({
      bytes,
      truncated: result.data.meta.truncated,
      totalSize: result.data.meta.totalSize,
      etag: result.data.meta.etag,
    });
  }

  async writeText(targetPath: string, content: string): Promise<Result<WriteFileResult, FsError>> {
    return this.upload(targetPath, Buffer.from(content, 'utf8'));
  }

  writeBytes(targetPath: string, bytes: Uint8Array): Promise<Result<WriteFileResult, FsError>> {
    return this.upload(targetPath, bytes);
  }

  async stat(targetPath: string): Promise<Result<FileStat, FsError>> {
    const result = await (
      await this.getClient()
    ).fs.stat({
      root: this.root,
      relative: this.relative(targetPath),
    });
    return result.success ? ok(toFileStat(this.rootPath, result.data)) : result;
  }

  async measureUsage(targetPath: string): Promise<Result<FileUsage, FsError>> {
    const result = await (
      await this.getClient()
    ).fs.measureUsage({
      root: this.root,
      relative: this.relative(targetPath),
    });
    if (!result.success) return result;
    return ok({
      ...result.data,
      path: targetPath,
      errors: result.data.errors.map((error) => ({
        path: nativePathFromHost(resolveRelativePath(this.root, error.path)),
        message: error.message,
      })),
    });
  }

  async exists(targetPath: string): Promise<Result<boolean, FsError>> {
    return (await this.getClient()).fs.exists({
      root: this.root,
      relative: this.relative(targetPath),
    });
  }

  async mkdir(
    targetPath: string,
    options: { recursive?: boolean } = {}
  ): Promise<Result<void, FsError>> {
    const relative = this.relative(targetPath);
    if (!relative) return ok<void>();
    const client = await this.getClient();
    const candidates = options.recursive ? parentPaths(relative) : [relative];
    for (const candidate of candidates) {
      const exists = await client.fs.exists({ root: this.root, relative: candidate });
      if (!exists.success) return exists;
      if (exists.data) continue;
      const created = await client.mutations.createDirectory({ root: this.root, path: candidate });
      if (!created.success && created.error.type !== 'already-exists') return created;
    }
    return ok<void>();
  }

  async remove(
    targetPath: string,
    options: { recursive?: boolean } = {}
  ): Promise<Result<void, FsError>> {
    return (await this.getClient()).mutations.delete({
      root: this.root,
      path: this.relative(targetPath),
      recursive: options.recursive,
    });
  }

  async realPath(targetPath: string): Promise<Result<string, FsError>> {
    const result = await (
      await this.getClient()
    ).fs.realPath({
      root: this.root,
      relative: this.relative(targetPath),
    });
    return result.success ? ok(nativePathFromHost(result.data)) : result;
  }

  async copyFile(src: string, dest: string): Promise<Result<void, FsError>> {
    const destParent = path.dirname(dest);
    const madeParent = await this.mkdir(destParent, { recursive: true });
    if (!madeParent.success) return madeParent;
    return (await this.getClient()).mutations.copy({
      root: this.root,
      from: this.relative(src),
      to: this.relative(dest),
    });
  }

  glob(
    patterns: string[],
    options: { cwd: string; dot?: boolean }
  ): Result<AsyncIterable<string>, FsError> {
    if (patterns.length === 0) {
      return err({ type: 'invalid-path', path: '', message: 'At least one pattern is required' });
    }
    const cwd = this.relative(options.cwd);
    return ok(this.globPaths(patterns, cwd, options.dot));
  }

  enumerate(
    targetPath: string,
    options: { exclude?: FileExclusionPredicate; includeSymlinkFiles?: boolean } = {}
  ): Result<AsyncIterable<string>, FsError> {
    return ok(
      this.enumeratePaths(this.relative(targetPath), options.exclude, options.includeSymlinkFiles)
    );
  }

  private async upload(
    targetPath: string,
    bytes: Uint8Array
  ): Promise<Result<WriteFileResult, FsError>> {
    const result = await (
      await this.getClient()
    ).fs.upload(
      { root: this.root, path: this.relative(targetPath), overwrite: true },
      {
        name: path.basename(targetPath),
        mimeType: 'application/octet-stream',
        size: bytes.byteLength,
        source: singleChunk(bytes),
      }
    );
    return result.success ? ok(result.data) : result;
  }

  private relative(targetPath: string): PortableRelativePath {
    return relativePathWithin(this.root, hostPathFromNative(path.resolve(targetPath)));
  }

  private async *globPaths(
    patterns: string[],
    cwd: PortableRelativePath,
    dot?: boolean
  ): AsyncIterable<string> {
    const client = await this.getClient();
    const jobs = createLiveJobReplica(client.fs.glob.def, client.fs.glob);
    const lease = await jobs.start({ root: this.root, patterns, options: { cwd, dot } });
    try {
      const job = await lease.ready();
      const result = await job.result;
      for (const relative of result.paths) {
        yield nativePathFromHost(resolveRelativePath(this.root, relative));
      }
    } finally {
      await lease.release();
      await jobs.dispose();
    }
  }

  private async *enumeratePaths(
    relative: PortableRelativePath,
    exclude?: FileExclusionPredicate,
    includeSymlinkFiles?: boolean
  ): AsyncIterable<string> {
    const client = await this.getClient();
    const jobs = createLiveJobReplica(client.fs.enumerate.def, client.fs.enumerate);
    const lease = await jobs.start({
      root: this.root,
      relative,
      options: { includeSymlinkFiles },
    });
    try {
      const job = await lease.ready();
      const result = await job.result;
      for (const item of result.paths) {
        const absolute = nativePathFromHost(resolveRelativePath(this.root, item));
        if (!exclude?.(absolute)) yield absolute;
      }
    } catch (error) {
      if (error instanceof LiveJobFailedError && error.error) {
        throw new Error(fsErrorMessage(error.error));
      }
      throw error;
    } finally {
      await lease.release();
      await jobs.dispose();
    }
  }
}

function toFileStat(rootPath: string, stat: RuntimeFileStat): FileStat {
  return {
    path: path.join(rootPath, ...stat.path.split('/')),
    type: stat.type,
    size: stat.size,
    mtime: new Date(stat.mtimeMs),
    ctime: new Date(stat.ctimeMs),
    mode: stat.mode,
  };
}

function parentPaths(relative: PortableRelativePath): PortableRelativePath[] {
  const parts = relative.split('/');
  return parts.map((_, index) => portablePath(parts.slice(0, index + 1).join('/')));
}

async function* singleChunk(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}
