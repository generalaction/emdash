import { promises as fs } from 'node:fs';
import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import { classifyFileError, type FileError } from '../errors';
import { resolveInsideRoot } from '../paths';
import type {
  FileStat,
  IFileSystem,
  ReadBytesResult,
  ReadFileOptions,
  ReadTextResult,
  WriteFileResult,
} from './types';

const DEFAULT_MAX_BYTES = 200 * 1024;
const MAX_READ_BYTES = 100 * 1024 * 1024;

export class FileSystem implements IFileSystem {
  constructor(private readonly rootPath: string) {}

  async readText(
    relPath: string,
    options?: ReadFileOptions
  ): Promise<Result<ReadTextResult, FileError>> {
    const result = await this.readBytes(relPath, options);
    if (!result.success) return result;
    return ok({
      content: Buffer.from(result.data.bytes).toString('utf8'),
      truncated: result.data.truncated,
      totalSize: result.data.totalSize,
    });
  }

  async readBytes(
    relPath: string,
    options: ReadFileOptions = {}
  ): Promise<Result<ReadBytesResult, FileError>> {
    const resolved = this.resolve(relPath);
    if (!resolved.success) return resolved;

    try {
      const stat = await fs.stat(resolved.data.absPath);
      if (stat.isDirectory()) {
        return err({
          type: 'fs-error',
          path: relPath,
          message: `Path is a directory: ${relPath}`,
          code: 'EISDIR',
        });
      }

      const maxBytes = normalizeMaxBytes(options.maxBytes);
      const readSize = Math.min(stat.size, maxBytes);
      if (readSize === 0) {
        return ok({
          bytes: new Uint8Array(),
          truncated: stat.size > maxBytes,
          totalSize: stat.size,
        });
      }

      const handle = await fs.open(resolved.data.absPath, 'r');
      try {
        const buffer = Buffer.alloc(readSize);
        const { bytesRead } = await handle.read(buffer, 0, readSize, 0);
        return ok({
          bytes: buffer.subarray(0, bytesRead),
          truncated: stat.size > readSize,
          totalSize: stat.size,
        });
      } finally {
        await handle.close();
      }
    } catch (error) {
      return err(classifyFileError(error, relPath));
    }
  }

  async writeText(relPath: string, content: string): Promise<Result<WriteFileResult, FileError>> {
    return this.writeBuffer(relPath, Buffer.from(content, 'utf8'));
  }

  async writeBytes(
    relPath: string,
    bytes: Uint8Array
  ): Promise<Result<WriteFileResult, FileError>> {
    return this.writeBuffer(relPath, Buffer.from(bytes));
  }

  async stat(relPath: string): Promise<Result<FileStat, FileError>> {
    const resolved = this.resolve(relPath);
    if (!resolved.success) return resolved;

    try {
      const stat = await fs.stat(resolved.data.absPath);
      return ok({
        path: resolved.data.relPath,
        type: stat.isDirectory() ? 'directory' : 'file',
        size: stat.size,
        mtime: stat.mtime,
        ctime: stat.ctime,
        mode: stat.mode,
      });
    } catch (error) {
      return err(classifyFileError(error, relPath));
    }
  }

  async exists(relPath: string): Promise<Result<boolean, FileError>> {
    const resolved = this.resolve(relPath);
    if (!resolved.success) return resolved;

    try {
      await fs.access(resolved.data.absPath);
      return ok(true);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return ok(false);
      return err(classifyFileError(error, relPath));
    }
  }

  async mkdir(
    relPath: string,
    options: { recursive?: boolean } = {}
  ): Promise<Result<void, FileError>> {
    const resolved = this.resolve(relPath, { allowEmpty: true });
    if (!resolved.success) return resolved;
    if (resolved.data.relPath === '') return ok<void>();

    try {
      await fs.mkdir(resolved.data.absPath, { recursive: options.recursive ?? false });
      return ok<void>();
    } catch (error) {
      return err(classifyFileError(error, relPath));
    }
  }

  async remove(
    relPath: string,
    options: { recursive?: boolean } = {}
  ): Promise<Result<void, FileError>> {
    const resolved = this.resolve(relPath);
    if (!resolved.success) return resolved;

    try {
      const stat = await fs.stat(resolved.data.absPath);
      if (stat.isDirectory()) {
        if (!options.recursive) {
          return err({
            type: 'fs-error',
            path: relPath,
            message: `Path is a directory: ${relPath}`,
            code: 'EISDIR',
          });
        }
        await fs.rm(resolved.data.absPath, { recursive: true, force: true });
        return ok<void>();
      }

      await this.unlinkFile(resolved.data.absPath);
      return ok<void>();
    } catch (error) {
      return err(classifyFileError(error, relPath));
    }
  }

  async realPath(relPath: string): Promise<Result<string, FileError>> {
    const resolved = this.resolve(relPath, { allowEmpty: true });
    if (!resolved.success) return resolved;

    try {
      return ok(await fs.realpath(resolved.data.absPath));
    } catch (error) {
      return err(classifyFileError(error, relPath));
    }
  }

  async copyFile(src: string, dest: string): Promise<Result<void, FileError>> {
    const resolvedSrc = this.resolve(src);
    if (!resolvedSrc.success) return resolvedSrc;
    const resolvedDest = this.resolve(dest);
    if (!resolvedDest.success) return resolvedDest;

    try {
      await fs.mkdir(path.dirname(resolvedDest.data.absPath), { recursive: true });
      await fs.copyFile(resolvedSrc.data.absPath, resolvedDest.data.absPath);
      return ok<void>();
    } catch (error) {
      return err(classifyFileError(error, dest));
    }
  }

  private async writeBuffer(
    relPath: string,
    buffer: Buffer
  ): Promise<Result<WriteFileResult, FileError>> {
    const resolved = this.resolve(relPath);
    if (!resolved.success) return resolved;

    try {
      await fs.mkdir(path.dirname(resolved.data.absPath), { recursive: true });
      await fs.writeFile(resolved.data.absPath, buffer);
      return ok({ bytesWritten: buffer.byteLength });
    } catch (error) {
      return err(classifyFileError(error, relPath));
    }
  }

  private async unlinkFile(absPath: string): Promise<void> {
    try {
      await fs.unlink(absPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EACCES' && code !== 'EPERM') throw error;

      await fs.chmod(absPath, 0o666);
      await fs.unlink(absPath);
    }
  }

  private resolve(relPath: string, options: { allowEmpty?: boolean } = {}) {
    return resolveInsideRoot(this.rootPath, relPath, options);
  }
}

function normalizeMaxBytes(maxBytes: number | undefined): number {
  if (maxBytes === undefined) return DEFAULT_MAX_BYTES;
  if (!Number.isFinite(maxBytes) || maxBytes < 0) return 0;
  return Math.min(Math.floor(maxBytes), MAX_READ_BYTES);
}
