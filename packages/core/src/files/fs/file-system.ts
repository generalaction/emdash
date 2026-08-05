import { promises as fs } from 'node:fs';
import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import { globIterate } from 'glob';
import { realpathOrResolve } from '../../services/fs-watch/impl/paths';
import { enumerate as enumerateFiles } from '../enumerate';
import { classifyFileError, isFileNotFoundCode, type FileError } from '../errors';
import { validateAbsolutePath } from '../paths';
import { measureUsage } from './measure-usage';
import type {
  FileEnumeration,
  FileEnumerationOptions,
  FileGlob,
  FileGlobOptions,
  FileStat,
  FileUsage,
  IFileSystem,
  ReadBytesResult,
  ReadFileOptions,
  ReadTextResult,
  WriteFileResult,
} from './types';

const DEFAULT_MAX_BYTES = 200 * 1024;
const MAX_READ_BYTES = 100 * 1024 * 1024;

export class FileSystem implements IFileSystem {
  async readText(
    absPath: string,
    options?: ReadFileOptions
  ): Promise<Result<ReadTextResult, FileError>> {
    const result = await this.readBytes(absPath, options);
    if (!result.success) return result;
    return ok({
      content: Buffer.from(result.data.bytes).toString('utf8'),
      truncated: result.data.truncated,
      totalSize: result.data.totalSize,
    });
  }

  async readBytes(
    absPath: string,
    options: ReadFileOptions = {}
  ): Promise<Result<ReadBytesResult, FileError>> {
    const validated = validateAbsolutePath(absPath);
    if (!validated.success) return validated;

    try {
      const stat = await fs.stat(validated.data);
      if (stat.isDirectory()) {
        return err({
          type: 'fs-error',
          path: validated.data,
          message: `Path is a directory: ${validated.data}`,
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

      const handle = await fs.open(validated.data, 'r');
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
      return err(classifyFileError(error, validated.data));
    }
  }

  async writeText(absPath: string, content: string): Promise<Result<WriteFileResult, FileError>> {
    return this.writeBuffer(absPath, Buffer.from(content, 'utf8'));
  }

  async writeBytes(
    absPath: string,
    bytes: Uint8Array
  ): Promise<Result<WriteFileResult, FileError>> {
    return this.writeBuffer(absPath, Buffer.from(bytes));
  }

  async stat(absPath: string): Promise<Result<FileStat, FileError>> {
    const validated = validateAbsolutePath(absPath);
    if (!validated.success) return validated;

    try {
      const stat = await fs.stat(validated.data);
      return ok({
        path: validated.data,
        type: stat.isDirectory() ? 'directory' : 'file',
        size: stat.size,
        mtime: stat.mtime,
        ctime: stat.ctime,
        mode: stat.mode,
      });
    } catch (error) {
      return err(classifyFileError(error, validated.data));
    }
  }

  async measureUsage(absPath: string): Promise<Result<FileUsage, FileError>> {
    const validated = validateAbsolutePath(absPath);
    if (!validated.success) return validated;

    try {
      return ok(await measureUsage(validated.data));
    } catch (error) {
      return err(classifyFileError(error, validated.data));
    }
  }

  async exists(absPath: string): Promise<Result<boolean, FileError>> {
    const validated = validateAbsolutePath(absPath);
    if (!validated.success) return validated;

    try {
      await fs.access(validated.data);
      return ok(true);
    } catch (error) {
      if (isFileNotFoundCode((error as NodeJS.ErrnoException).code)) return ok(false);
      return err(classifyFileError(error, validated.data));
    }
  }

  async mkdir(
    absPath: string,
    options: { recursive?: boolean } = {}
  ): Promise<Result<void, FileError>> {
    const validated = validateAbsolutePath(absPath);
    if (!validated.success) return validated;

    try {
      await fs.mkdir(validated.data, { recursive: options.recursive ?? false });
      return ok<void>();
    } catch (error) {
      return err(classifyFileError(error, validated.data));
    }
  }

  async remove(
    absPath: string,
    options: { recursive?: boolean } = {}
  ): Promise<Result<void, FileError>> {
    const validated = validateAbsolutePath(absPath);
    if (!validated.success) return validated;

    try {
      const stat = await fs.lstat(validated.data);
      if (stat.isDirectory()) {
        if (!options.recursive) {
          return err({
            type: 'fs-error',
            path: validated.data,
            message: `Path is a directory: ${validated.data}`,
            code: 'EISDIR',
          });
        }
        // Retry transient EBUSY/EPERM/ENOTEMPTY failures (e.g. a watcher or
        // antivirus briefly holding a handle, common on Windows).
        await fs.rm(validated.data, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        });
        return ok<void>();
      }

      await this.unlinkFile(validated.data);
      return ok<void>();
    } catch (error) {
      return err(classifyFileError(error, validated.data));
    }
  }

  async realPath(absPath: string): Promise<Result<string, FileError>> {
    const validated = validateAbsolutePath(absPath);
    if (!validated.success) return validated;

    try {
      return ok(await fs.realpath(validated.data));
    } catch (error) {
      return err(classifyFileError(error, validated.data));
    }
  }

  async copyFile(src: string, dest: string): Promise<Result<void, FileError>> {
    const validatedSrc = validateAbsolutePath(src);
    if (!validatedSrc.success) return validatedSrc;
    const validatedDest = validateAbsolutePath(dest);
    if (!validatedDest.success) return validatedDest;

    try {
      await fs.mkdir(path.dirname(validatedDest.data), { recursive: true });
      await fs.copyFile(validatedSrc.data, validatedDest.data);
      const sourceStat = await fs.stat(validatedSrc.data);
      await fs.chmod(validatedDest.data, sourceStat.mode);
      return ok<void>();
    } catch (error) {
      return err(classifyFileError(error, validatedDest.data));
    }
  }

  glob(patterns: string[], options: FileGlobOptions): Result<FileGlob, FileError> {
    const validated = validateGlobArgs(patterns, options);
    if (!validated.success) return validated;
    return ok(this.globPaths(validated.data.patterns, validated.data.cwd, options));
  }

  enumerate(
    absPath: string,
    options: FileEnumerationOptions = {}
  ): Result<FileEnumeration, FileError> {
    const validated = validateAbsolutePath(absPath);
    if (!validated.success) return validated;
    return ok(enumerateFiles(realpathOrResolve(validated.data), options));
  }

  private async writeBuffer(
    absPath: string,
    buffer: Buffer
  ): Promise<Result<WriteFileResult, FileError>> {
    const validated = validateAbsolutePath(absPath);
    if (!validated.success) return validated;

    try {
      await fs.mkdir(path.dirname(validated.data), { recursive: true });
      await fs.writeFile(validated.data, buffer);
      return ok({ bytesWritten: buffer.byteLength });
    } catch (error) {
      return err(classifyFileError(error, validated.data));
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

  private async *globPaths(patterns: string[], cwd: string, options: FileGlobOptions): FileGlob {
    for await (const match of globIterate(patterns, {
      absolute: false,
      cwd,
      dot: options.dot ?? false,
      follow: false,
    })) {
      if (typeof match !== 'string') continue;
      yield path.resolve(cwd, match);
    }
  }
}

function normalizeMaxBytes(maxBytes: number | undefined): number {
  if (maxBytes === undefined) return DEFAULT_MAX_BYTES;
  if (!Number.isFinite(maxBytes) || maxBytes < 0) return 0;
  return Math.min(Math.floor(maxBytes), MAX_READ_BYTES);
}

function validateGlobArgs(
  patterns: string[],
  options: FileGlobOptions
): Result<{ patterns: string[]; cwd: string }, FileError> {
  if (patterns.length === 0) {
    return err({
      type: 'invalid-path',
      path: '',
      message: 'At least one glob pattern is required',
    });
  }

  const cwd = validateAbsolutePath(options.cwd);
  if (!cwd.success) return cwd;

  const normalizedPatterns: string[] = [];
  for (const pattern of patterns) {
    if (!pattern) {
      return err({
        type: 'invalid-path',
        path: pattern,
        message: 'Glob pattern must not be empty',
      });
    }
    if (pattern.includes('\0')) {
      return err({ type: 'invalid-path', path: pattern, message: 'Path contains a null byte' });
    }
    normalizedPatterns.push(pattern.replace(/\\/g, '/'));
  }
  return ok({ patterns: normalizedPatterns, cwd: cwd.data });
}
