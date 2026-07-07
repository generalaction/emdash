import path from 'node:path';
import {
  type FileEnumeration,
  type FileError,
  type FileGlob,
  type FileGlobOptions,
  type FileStat,
  type FileUsage,
  type IFileSystem,
  type ReadBytesResult,
  type ReadFileOptions,
  type ReadTextResult,
  type WriteFileResult,
} from '@emdash/core/files';
import { err, ok, type Result } from '@emdash/shared';
import type { SFTPWrapper } from 'ssh2';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import { SshFileSystem } from './ssh-legacy-fs';
import { FileSystemError, FileSystemErrorCodes, type FileEntry } from './ssh-legacy-fs-types';
import { normalizeRemoteAbsolutePath, normalizeRemoteRootPath } from './ssh-paths';
import { enumerateRemoteWorkspace } from './ssh-remote-enumerate';

const DEFAULT_MAX_BYTES = 200 * 1024;
const MAX_READ_BYTES = 100 * 1024 * 1024;

const SFTP_STATUS = {
  NO_SUCH_FILE: 2,
  PERMISSION_DENIED: 3,
  FAILURE: 4,
} as const;

type SftpError = Error & { code?: number };

export class LegacySshFileSystem implements IFileSystem {
  private readonly legacy: SshFileSystem;
  private cachedSftp: SFTPWrapper | undefined;

  constructor(private readonly proxy: SshClientProxy) {
    this.legacy = new SshFileSystem(proxy, '/');
  }

  async readText(
    absPath: string,
    options?: ReadFileOptions
  ): Promise<Result<ReadTextResult, FileError>> {
    const normalized = normalizeRemoteAbsolutePath(absPath);
    if (!normalized.success) return normalized;

    try {
      return ok(await this.legacy.read(normalized.data, options?.maxBytes));
    } catch (error) {
      return err(toFileError(error, absPath));
    }
  }

  async readBytes(
    absPath: string,
    options: ReadFileOptions = {}
  ): Promise<Result<ReadBytesResult, FileError>> {
    const resolved = normalizeRemoteAbsolutePath(absPath);
    if (!resolved.success) return resolved;

    try {
      const sftp = await this.getSftp();
      return await this.readRemoteBytes(sftp, absPath, resolved.data, options.maxBytes);
    } catch (error) {
      return err(toFileError(error, absPath));
    }
  }

  async writeText(absPath: string, content: string): Promise<Result<WriteFileResult, FileError>> {
    const normalized = normalizeRemoteAbsolutePath(absPath);
    if (!normalized.success) return normalized;

    try {
      const result = await this.legacy.write(normalized.data, content);
      if (!result.success) {
        return err({
          type: 'fs-error',
          path: absPath,
          message: result.error ?? `Failed to write file: ${absPath}`,
        });
      }
      return ok({ bytesWritten: result.bytesWritten });
    } catch (error) {
      return err(toFileError(error, absPath));
    }
  }

  async writeBytes(
    absPath: string,
    bytes: Uint8Array
  ): Promise<Result<WriteFileResult, FileError>> {
    const resolved = normalizeRemoteAbsolutePath(absPath);
    if (!resolved.success) return resolved;

    try {
      const sftp = await this.getSftp();
      const parentDir = path.posix.dirname(resolved.data);
      await this.ensureRemoteDir(sftp, parentDir);
      return await this.writeRemoteBytes(sftp, absPath, resolved.data, Buffer.from(bytes));
    } catch (error) {
      return err(toFileError(error, absPath));
    }
  }

  async stat(absPath: string): Promise<Result<FileStat, FileError>> {
    const normalized = normalizeRemoteAbsolutePath(absPath);
    if (!normalized.success) return normalized;

    try {
      const entry = await this.legacy.stat(normalized.data);
      if (!entry) {
        return err({
          type: 'fs-error',
          path: absPath,
          message: `File or directory not found: ${absPath}`,
          code: FileSystemErrorCodes.NOT_FOUND,
        });
      }
      return ok(toFileStat(entry));
    } catch (error) {
      return err(toFileError(error, absPath));
    }
  }

  async measureUsage(absPath: string): Promise<Result<FileUsage, FileError>> {
    // Recursive usage measurement over SFTP is not implemented; no current
    // feature measures remote paths. Callers get a typed error, not a throw.
    return err({
      type: 'fs-error',
      path: absPath,
      message: 'measureUsage is not supported for SSH workspaces',
      code: 'UNSUPPORTED',
    });
  }

  async exists(absPath: string): Promise<Result<boolean, FileError>> {
    const normalized = normalizeRemoteAbsolutePath(absPath);
    if (!normalized.success) return normalized;

    try {
      return ok(await this.legacy.exists(normalized.data));
    } catch (error) {
      return err(toFileError(error, absPath));
    }
  }

  async mkdir(
    absPath: string,
    options: { recursive?: boolean } = {}
  ): Promise<Result<void, FileError>> {
    const normalized = normalizeRemoteAbsolutePath(absPath);
    if (!normalized.success) return normalized;
    if (normalized.data === '/') return ok<void>();

    try {
      await this.legacy.mkdir(normalized.data, options);
      return ok<void>();
    } catch (error) {
      return err(toFileError(error, absPath));
    }
  }

  async remove(
    absPath: string,
    options: { recursive?: boolean } = {}
  ): Promise<Result<void, FileError>> {
    const normalized = normalizeRemoteAbsolutePath(absPath);
    if (!normalized.success) return normalized;

    try {
      const result = await this.legacy.remove(normalized.data, options);
      if (!result.success) {
        return err({
          type: 'fs-error',
          path: absPath,
          message: result.error ?? `Failed to remove file: ${absPath}`,
        });
      }
      return ok<void>();
    } catch (error) {
      return err(toFileError(error, absPath));
    }
  }

  async realPath(absPath: string): Promise<Result<string, FileError>> {
    const normalized = normalizeRemoteAbsolutePath(absPath);
    if (!normalized.success) return normalized;

    try {
      return ok(await this.legacy.realPath(normalized.data));
    } catch (error) {
      return err(toFileError(error, absPath));
    }
  }

  async copyFile(src: string, dest: string): Promise<Result<void, FileError>> {
    const normalizedSrc = normalizeRemoteAbsolutePath(src);
    if (!normalizedSrc.success) return normalizedSrc;
    const normalizedDest = normalizeRemoteAbsolutePath(dest);
    if (!normalizedDest.success) return normalizedDest;

    try {
      await this.legacy.copyFile(normalizedSrc.data, normalizedDest.data);
      return ok<void>();
    } catch (error) {
      return err(toFileError(error, dest));
    }
  }

  glob(patterns: string[], options: FileGlobOptions): Result<FileGlob, FileError> {
    const validated = validateGlobPatterns(patterns);
    if (!validated.success) return validated;
    const cwd = normalizeRemoteAbsolutePath(options.cwd);
    if (!cwd.success) return cwd;
    return ok(this.globPaths(validated.data, options));
  }

  enumerate(rootPath: string): Result<FileEnumeration, FileError> {
    const normalizedRoot = normalizeRemoteAbsolutePath(rootPath);
    if (!normalizedRoot.success) return normalizedRoot;
    return ok(enumerateRemoteWorkspace(this.proxy, normalizedRoot.data));
  }

  private getSftp(): Promise<SFTPWrapper> {
    if (this.cachedSftp) return Promise.resolve(this.cachedSftp);
    return new Promise((resolve, reject) => {
      this.proxy.sftp((error, sftp) => {
        if (error) {
          reject(error);
          return;
        }
        this.cachedSftp = sftp;
        sftp.on('close', () => {
          this.cachedSftp = undefined;
        });
        resolve(sftp);
      });
    });
  }

  private async *globPaths(patterns: string[], options: FileGlobOptions): FileGlob {
    const cwd = normalizeRemoteAbsolutePath(options.cwd);
    if (!cwd.success) return;

    const seen = new Set<string>();
    for (const pattern of patterns) {
      const matches = await this.legacy.glob(pattern, {
        cwd: cwd.data,
        dot: options.dot ?? false,
      });
      for (const match of matches) {
        const normalized = normalizeRemoteAbsolutePath(path.posix.resolve(cwd.data, match));
        if (!normalized.success || seen.has(normalized.data)) continue;
        seen.add(normalized.data);
        yield normalized.data;
      }
    }
  }

  private async readRemoteBytes(
    sftp: SFTPWrapper,
    relPath: string,
    fullPath: string,
    maxBytes: number | undefined
  ): Promise<Result<ReadBytesResult, FileError>> {
    return new Promise((resolve) => {
      sftp.open(fullPath, 'r', (openError, handle) => {
        if (openError) {
          resolve(err(toFileError(openError, relPath)));
          return;
        }

        sftp.fstat(handle, (statError, stats) => {
          if (statError) {
            closeRemoteHandle(sftp, handle);
            resolve(err(toFileError(statError, relPath)));
            return;
          }

          if (stats.isDirectory()) {
            closeRemoteHandle(sftp, handle);
            resolve(
              err({
                type: 'fs-error',
                path: relPath,
                message: `Path is a directory: ${relPath}`,
                code: FileSystemErrorCodes.IS_DIRECTORY,
              })
            );
            return;
          }

          const readSize = Math.min(stats.size, normalizeMaxBytes(maxBytes));
          if (readSize === 0) {
            closeRemoteHandle(sftp, handle);
            resolve(
              ok({
                bytes: new Uint8Array(),
                truncated: stats.size > readSize,
                totalSize: stats.size,
              })
            );
            return;
          }

          const buffer = Buffer.alloc(readSize);
          sftp.read(handle, buffer, 0, readSize, 0, (readError, bytesRead) => {
            closeRemoteHandle(sftp, handle);
            if (readError) {
              resolve(err(toFileError(readError, relPath)));
              return;
            }
            resolve(
              ok({
                bytes: buffer.subarray(0, bytesRead),
                truncated: stats.size > readSize,
                totalSize: stats.size,
              })
            );
          });
        });
      });
    });
  }

  private async writeRemoteBytes(
    sftp: SFTPWrapper,
    relPath: string,
    fullPath: string,
    buffer: Buffer
  ): Promise<Result<WriteFileResult, FileError>> {
    return new Promise((resolve) => {
      sftp.open(fullPath, 'w', (openError, handle) => {
        if (openError) {
          resolve(err(toFileError(openError, relPath)));
          return;
        }

        sftp.write(handle, buffer, 0, buffer.length, 0, (writeError) => {
          closeRemoteHandle(sftp, handle);
          if (writeError) {
            resolve(err(toFileError(writeError, relPath)));
            return;
          }
          resolve(ok({ bytesWritten: buffer.byteLength }));
        });
      });
    });
  }

  private async ensureRemoteDir(sftp: SFTPWrapper, dirPath: string): Promise<void> {
    const normalizedDir = normalizeRemoteRootPath(dirPath);
    if (normalizedDir === '/') return;

    const kind = await this.remoteEntryKind(sftp, normalizedDir);
    if (kind === 'directory') return;
    if (kind === 'file') {
      throw new FileSystemError(
        `Path is not a directory: ${normalizedDir}`,
        FileSystemErrorCodes.NOT_DIRECTORY,
        normalizedDir
      );
    }

    const parentDir = path.posix.dirname(normalizedDir);
    if (parentDir && parentDir !== normalizedDir) await this.ensureRemoteDir(sftp, parentDir);
    await this.mkdirRemote(sftp, normalizedDir);
  }

  private remoteEntryKind(
    sftp: SFTPWrapper,
    fullPath: string
  ): Promise<'file' | 'directory' | undefined> {
    return new Promise((resolve, reject) => {
      sftp.stat(fullPath, (error, stats) => {
        if (!error) {
          resolve(stats.isDirectory() ? 'directory' : 'file');
          return;
        }
        if (isNoSuchFile(error)) {
          resolve(undefined);
          return;
        }
        reject(error);
      });
    });
  }

  private mkdirRemote(sftp: SFTPWrapper, fullPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      sftp.mkdir(fullPath, (error) => {
        if (!error || isAlreadyExists(error)) {
          resolve();
          return;
        }
        reject(error);
      });
    });
  }
}

function toFileStat(entry: FileEntry): FileStat {
  return {
    path: entry.path,
    type: entry.type === 'dir' ? 'directory' : 'file',
    size: entry.size ?? 0,
    mtime: entry.mtime ?? new Date(0),
    ctime: entry.ctime ?? new Date(0),
    mode: entry.mode ?? 0,
  };
}

function toFileError(error: unknown, absPath: string): FileError {
  if (error instanceof FileSystemError) {
    return { type: 'fs-error', path: absPath, message: error.message, code: error.code };
  }

  const sftpError = error as SftpError | undefined;
  const message = typeof sftpError?.message === 'string' ? sftpError.message : String(error);
  const code = mapSftpErrorCode(sftpError);
  return {
    type: 'fs-error',
    path: absPath,
    message,
    ...(code ? { code } : {}),
  };
}

function mapSftpErrorCode(error: SftpError | undefined): string | undefined {
  if (!error) return undefined;
  if (error.code === SFTP_STATUS.NO_SUCH_FILE) return FileSystemErrorCodes.NOT_FOUND;
  if (error.code === SFTP_STATUS.PERMISSION_DENIED) return FileSystemErrorCodes.PERMISSION_DENIED;
  const message = error.message ?? '';
  if (message.includes('No such file')) return FileSystemErrorCodes.NOT_FOUND;
  if (message.includes('Permission denied')) return FileSystemErrorCodes.PERMISSION_DENIED;
  if (message.includes('is a directory')) return FileSystemErrorCodes.IS_DIRECTORY;
  if (message.includes('Not a directory')) return FileSystemErrorCodes.NOT_DIRECTORY;
  return undefined;
}

function normalizeMaxBytes(maxBytes: number | undefined): number {
  if (maxBytes === undefined) return DEFAULT_MAX_BYTES;
  if (!Number.isFinite(maxBytes) || maxBytes < 0) return 0;
  return Math.min(Math.floor(maxBytes), MAX_READ_BYTES);
}

function validateGlobPatterns(patterns: string[]): Result<string[], FileError> {
  if (patterns.length === 0) {
    return err({
      type: 'invalid-path',
      path: '',
      message: 'At least one glob pattern is required',
    });
  }

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
    if (path.posix.isAbsolute(pattern) || path.win32.isAbsolute(pattern)) {
      return err({
        type: 'invalid-path',
        path: pattern,
        message: 'Absolute paths are not allowed',
      });
    }

    const parts = pattern.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.includes('..')) {
      return err({
        type: 'invalid-path',
        path: pattern,
        message: 'Parent path segments are not allowed',
      });
    }
    normalizedPatterns.push(pattern.replace(/\\/g, '/'));
  }
  return ok(normalizedPatterns);
}

function isNoSuchFile(error: unknown): boolean {
  const sftpError = error as SftpError | undefined;
  return (
    sftpError?.code === SFTP_STATUS.NO_SUCH_FILE ||
    (sftpError?.message ?? '').includes('No such file')
  );
}

function isAlreadyExists(error: unknown): boolean {
  const sftpError = error as SftpError | undefined;
  const message = sftpError?.message ?? '';
  return (
    message.includes('already exists') ||
    message.includes('File exists') ||
    sftpError?.code === SFTP_STATUS.FAILURE
  );
}

function closeRemoteHandle(sftp: SFTPWrapper, handle: Buffer): void {
  sftp.close(handle, () => {});
}
