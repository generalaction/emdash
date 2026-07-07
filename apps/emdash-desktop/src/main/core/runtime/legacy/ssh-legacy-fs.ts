/**
 * Remote FileSystem implementation
 * Uses SFTP over SSH for remote filesystem operations
 */

import { posix as pathPosix } from 'node:path';
import type { FileSymlinkInfo, FileSymlinkTargetType } from '@emdash/core/files';
import type { SFTPWrapper } from 'ssh2';
import { buildRemoteShellCommand } from '@main/core/ssh/lifecycle/remote-shell-profile';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import { quoteShellArg } from '@main/utils/shellEscape';
import type { FileWatchEvent } from '@shared/core/fs/fs';
import {
  FileSystemError,
  FileSystemErrorCodes,
  type FileEntry,
  type FileListResult,
  type LegacySshFileOperations,
  type FileWatcher,
  type ListOptions,
  type ReadResult,
  type WriteResult,
} from './ssh-legacy-fs-types';

const SFTP_STATUS = {
  NO_SUCH_FILE: 2,
  PERMISSION_DENIED: 3,
  FAILURE: 4,
} as const;

interface SftpError extends Error {
  code?: number;
}

type SftpAttrs = {
  isDirectory(): boolean;
  isFile?(): boolean;
  isSymbolicLink?(): boolean;
  size: number;
  mtime: number;
  atime: number;
  mode: number;
};

/**
 * Maximum file size for reading (100MB to prevent memory issues)
 */
const MAX_READ_SIZE = 100 * 1024 * 1024;

/**
 * Default max bytes for read operations
 */
const DEFAULT_MAX_BYTES = 200 * 1024;

function fileEntryMetadataChanged(prev: FileEntry, next: FileEntry): boolean {
  return (
    prev.type !== next.type ||
    prev.size !== next.size ||
    prev.mode !== next.mode ||
    prev.mtime?.getTime() !== next.mtime?.getTime()
  );
}

function sshEntryType(attrs: {
  isDirectory(): boolean;
  isSymbolicLink?(): boolean;
}): FileEntry['type'] {
  if (attrs.isSymbolicLink?.()) return 'symlink';
  return attrs.isDirectory() ? 'dir' : 'file';
}

function fileWatchEntryType(entry: FileEntry): FileWatchEvent['entryType'] {
  if (entry.type === 'dir') return 'directory';
  if (entry.type === 'symlink') return 'symlink';
  return 'file';
}

function sftpReadlink(sftp: SFTPWrapper, fullPath: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    sftp.readlink(fullPath, (error, targetPath) => {
      resolve(error ? undefined : targetPath);
    });
  });
}

function sftpRealpath(sftp: SFTPWrapper, fullPath: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    sftp.realpath(fullPath, (error, realPath) => {
      resolve(error ? undefined : realPath);
    });
  });
}

function sftpStat(sftp: SFTPWrapper, fullPath: string): Promise<SftpAttrs> {
  return new Promise((resolve, reject) => {
    sftp.stat(fullPath, (error, stats) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stats as SftpAttrs);
    });
  });
}

function targetTypeForSftpStat(stats: SftpAttrs): FileSymlinkTargetType {
  if (stats.isFile?.()) return 'file';
  if (stats.isDirectory()) return 'directory';
  return 'other';
}

/**
 * Legacy SSH `LegacySshFileOperations` implementation using SFTP/SSH exec.
 *
 * This remains active for non-tree file operations and transitional SSH
 * adapters. The editor file tree uses `LegacySshFilesRuntime` only as a
 * temporary bridge until the `@emdash/core` file-tree runtime can run where the
 * remote workspace lives.
 */
export class SshFileSystem implements LegacySshFileOperations {
  private cachedSftp: SFTPWrapper | undefined;

  constructor(
    private readonly proxy: SshClientProxy,
    private readonly remotePath: string
  ) {
    if (!remotePath) {
      throw new FileSystemError('Remote path is required', FileSystemErrorCodes.INVALID_PATH);
    }
    // Normalize remote path to use forward slashes
    this.remotePath = remotePath.replace(/\\/g, '/');
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private getSftp(): Promise<SFTPWrapper> {
    if (this.cachedSftp) return Promise.resolve(this.cachedSftp);
    return new Promise((resolve, reject) => {
      this.proxy.sftp((err, sftp) => {
        if (err) return reject(err);
        this.cachedSftp = sftp;
        sftp.on('close', () => {
          this.cachedSftp = undefined;
        });
        resolve(sftp);
      });
    });
  }

  private async exec(
    command: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const profile = await this.proxy.getRemoteShellProfile();
    const full = buildRemoteShellCommand(profile, command);
    return new Promise((resolve, reject) => {
      this.proxy.exec(full, (err, stream) => {
        if (err) return reject(err);
        let stdout = '';
        let stderr = '';
        stream.on('close', (code: number | null) => {
          resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? -1 });
        });
        stream.on('data', (d: Buffer) => {
          stdout += d.toString('utf-8');
        });
        stream.stderr.on('data', (d: Buffer) => {
          stderr += d.toString('utf-8');
        });
        stream.on('error', reject);
      });
    });
  }

  // ─── IFileSystem ──────────────────────────────────────────────────────────

  /**
   * List directory contents via SFTP
   */
  async list(path: string = '', options?: ListOptions): Promise<FileListResult> {
    const startTime = Date.now();
    const fullPath = this.resolveRemotePath(path);
    const sftp = await this.getSftp();

    return new Promise((resolve, reject) => {
      sftp.readdir(fullPath, (err, list) => {
        if (err) {
          reject(this.mapSftpError(err, fullPath));
          return;
        }

        void this.buildListEntries(sftp, fullPath, list, options)
          .then((entries) => {
            // Sort entries: directories first, then files, both alphabetically
            entries.sort((a, b) => {
              if (a.type === b.type) {
                return a.path.localeCompare(b.path);
              }
              return a.type === 'dir' ? -1 : 1;
            });

            let result = entries;
            let truncated = false;
            let truncateReason: 'maxEntries' | 'timeBudget' | undefined;

            // Apply maxEntries limit
            if (options?.maxEntries && entries.length > options.maxEntries) {
              result = entries.slice(0, options.maxEntries);
              truncated = true;
              truncateReason = 'maxEntries';
            }

            // Apply time budget
            const durationMs = Date.now() - startTime;
            if (options?.timeBudgetMs && durationMs > options.timeBudgetMs) {
              truncated = true;
              truncateReason = 'timeBudget';
            }

            resolve({
              entries: result,
              total: entries.length,
              truncated,
              truncateReason,
              durationMs,
            });
          })
          .catch((error: unknown) => reject(error));
      });
    });
  }

  private async buildListEntries(
    sftp: SFTPWrapper,
    fullPath: string,
    list: Array<{ filename: string; attrs: SftpAttrs }>,
    options?: ListOptions
  ): Promise<FileEntry[]> {
    const entries: FileEntry[] = [];
    const seen = new Set<string>();

    for (const item of list) {
      // Skip hidden files if not included
      if (!options?.includeHidden && item.filename.startsWith('.')) {
        continue;
      }

      // Apply filter if provided
      if (options?.filter) {
        const filterRegex = new RegExp(options.filter);
        if (!filterRegex.test(item.filename)) {
          continue;
        }
      }

      const entryFullPath = pathPosix.join(fullPath, item.filename);
      const entryPath = this.relativePath(entryFullPath);
      if (seen.has(entryPath)) {
        continue;
      }
      seen.add(entryPath);

      const entryType = sshEntryType(item.attrs);
      const entry: FileEntry = {
        path: entryPath,
        type: entryType,
        ...(entryType === 'symlink'
          ? { symlink: await this.readSftpSymlinkInfo(sftp, entryFullPath) }
          : {}),
        size: item.attrs.size,
        mtime: new Date(item.attrs.mtime * 1000),
        ctime: new Date(item.attrs.atime * 1000),
        mode: item.attrs.mode,
      };

      entries.push(entry);

      // Handle recursive listing
      if (options?.recursive && item.attrs.isDirectory()) {
        // Note: Recursive listing is async and needs special handling
        // For now, we note that full recursive support requires additional implementation
      }
    }

    return entries;
  }

  private async readSftpSymlinkInfo(sftp: SFTPWrapper, fullPath: string): Promise<FileSymlinkInfo> {
    const targetPath = await sftpReadlink(sftp, fullPath);
    try {
      const targetStat = await sftpStat(sftp, fullPath);
      const realPath = await sftpRealpath(sftp, fullPath);
      return {
        ...(targetPath !== undefined ? { targetPath } : {}),
        ...(realPath !== undefined ? { realPath } : {}),
        targetType: targetTypeForSftpStat(targetStat),
        broken: false,
      };
    } catch {
      return {
        ...(targetPath !== undefined ? { targetPath } : {}),
        targetType: 'unknown',
        broken: true,
      };
    }
  }

  /**
   * Read file contents via SFTP
   * Handles large files by respecting maxBytes limit
   */
  async read(path: string, maxBytes: number = DEFAULT_MAX_BYTES): Promise<ReadResult> {
    const fullPath = this.resolveRemotePath(path);
    const sftp = await this.getSftp();

    return new Promise((resolve, reject) => {
      sftp.open(fullPath, 'r', (err, handle) => {
        if (err) {
          reject(this.mapSftpError(err, fullPath));
          return;
        }

        sftp.fstat(handle, (statErr, stats) => {
          if (statErr) {
            sftp.close(handle, () => {});
            reject(this.mapSftpError(statErr, fullPath));
            return;
          }

          // Check if it's a directory
          if (stats.isDirectory()) {
            sftp.close(handle, () => {});
            reject(
              new FileSystemError(
                `Path is a directory: ${path}`,
                FileSystemErrorCodes.IS_DIRECTORY,
                path
              )
            );
            return;
          }

          const fileSize = stats.size;
          const readSize = Math.min(fileSize, maxBytes, MAX_READ_SIZE);

          if (readSize === 0) {
            sftp.close(handle, () => {});
            resolve({ content: '', truncated: false, totalSize: fileSize });
            return;
          }

          const buffer = Buffer.alloc(readSize);

          sftp.read(handle, buffer, 0, readSize, 0, (readErr, bytesRead) => {
            sftp.close(handle, () => {});

            if (readErr) {
              reject(this.mapSftpError(readErr, fullPath));
              return;
            }

            // Convert buffer to string, handling only the bytes actually read
            const content = buffer.subarray(0, bytesRead).toString('utf-8');

            resolve({
              content,
              truncated: fileSize > maxBytes,
              totalSize: fileSize,
            });
          });
        });
      });
    });
  }

  /**
   * Write file contents via SFTP
   * Creates parent directories recursively if needed
   */
  async write(path: string, content: string): Promise<WriteResult> {
    const fullPath = this.resolveRemotePath(path);
    const sftp = await this.getSftp();

    // Ensure parent directory exists
    const lastSlash = fullPath.lastIndexOf('/');
    if (lastSlash > 0) {
      const parentDir = fullPath.substring(0, lastSlash);
      await this.ensureRemoteDir(sftp, parentDir);
    }

    return new Promise((resolve, reject) => {
      sftp.open(fullPath, 'w', (err, handle) => {
        if (err) {
          reject(this.mapSftpError(err, fullPath));
          return;
        }

        const buffer = Buffer.from(content, 'utf-8');

        if (buffer.length === 0) {
          sftp.close(handle, (closeErr) => {
            if (closeErr) {
              reject(this.mapSftpError(closeErr, fullPath));
              return;
            }
            resolve({ success: true, bytesWritten: 0 });
          });
          return;
        }

        sftp.write(handle, buffer, 0, buffer.length, 0, (writeErr) => {
          sftp.close(handle, (closeErr) => {
            if (writeErr) {
              reject(this.mapSftpError(writeErr, fullPath));
              return;
            }

            if (closeErr) {
              reject(this.mapSftpError(closeErr, fullPath));
              return;
            }

            resolve({
              success: true,
              bytesWritten: buffer.length,
            });
          });
        });
      });
    });
  }

  /**
   * Check if a path exists via SFTP
   */
  async exists(path: string): Promise<boolean> {
    try {
      const entry = await this.stat(path);
      return entry !== null;
    } catch {
      return false;
    }
  }

  async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    const fullPath = this.resolveRemotePath(dirPath);
    const sftp = await this.getSftp();
    if (options?.recursive) {
      await this.ensureRemoteDir(sftp, fullPath);
    } else {
      await new Promise<void>((resolve, reject) => {
        sftp.mkdir(fullPath, (err) => (err ? reject(this.mapSftpError(err, fullPath)) : resolve()));
      });
    }
  }

  async realPath(path: string): Promise<string> {
    const fullPath = this.resolveRemotePath(path);
    const result = await this.exec(`realpath ${quoteShellArg(fullPath)}`);
    if (result.exitCode !== 0) {
      throw new Error(`realpath failed: ${result.stderr}`);
    }
    return result.stdout.trim();
  }

  async glob(pattern: string, options?: { cwd?: string; dot?: boolean }): Promise<string[]> {
    const cwd = options?.cwd ? this.resolveRemotePath(options.cwd) : this.remotePath;
    const dotSetup = options?.dot ? 'shopt -s dotglob;' : '';
    const command = `${dotSetup} shopt -s nullglob; cd ${quoteShellArg(cwd)} && printf '%s\\n' ${pattern}`;
    try {
      const result = await this.exec(command);
      if (result.exitCode !== 0) return [];
      return result.stdout.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  async copyFile(src: string, dest: string): Promise<void> {
    const fullSrc = this.resolveRemotePath(src);
    const fullDest = this.resolveRemotePath(dest);
    const result = await this.exec(`cp ${quoteShellArg(fullSrc)} ${quoteShellArg(fullDest)}`);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to copy file: ${result.stderr}`);
    }
  }

  /**
   * Get file/directory metadata via SFTP
   */
  async stat(path: string): Promise<FileEntry | null> {
    const fullPath = this.resolveRemotePath(path);
    const sftp = await this.getSftp();

    return new Promise((resolve, reject) => {
      sftp.stat(fullPath, (err, stats) => {
        if (err) {
          // Check if file doesn't exist
          const sftpErr = err as SftpError;
          if (
            sftpErr.message?.includes('No such file') ||
            sftpErr.code === SFTP_STATUS.NO_SUCH_FILE
          ) {
            resolve(null);
            return;
          }
          reject(this.mapSftpError(err, fullPath));
          return;
        }

        resolve({
          path,
          type: stats.isDirectory() ? 'dir' : 'file',
          size: stats.size,
          mtime: new Date(stats.mtime * 1000),
          ctime: new Date(stats.atime * 1000),
          mode: stats.mode,
        });
      });
    });
  }

  /**
   * Remove a file via SFTP
   * For directories, uses SSH exec with rm -rf
   */
  async remove(
    path: string,
    options?: { recursive?: boolean }
  ): Promise<{ success: boolean; error?: string }> {
    const fullPath = this.resolveRemotePath(path);

    try {
      const entry = await this.stat(path);

      if (!entry) {
        return { success: false, error: `File not found: ${path}` };
      }

      const sftp = await this.getSftp();

      if (entry.type === 'dir') {
        if (!options?.recursive) {
          return { success: false, error: `Path is a directory: ${path}` };
        }
        const command = `rm -rf ${quoteShellArg(fullPath)}`;
        const result = await this.exec(command);

        if (result.exitCode !== 0) {
          return { success: false, error: result.stderr || 'Failed to remove directory' };
        }
      } else {
        // For files, use SFTP unlink
        return new Promise((resolve) => {
          sftp.unlink(fullPath, (err) => {
            if (err) {
              resolve({ success: false, error: err.message });
            } else {
              resolve({ success: true });
            }
          });
        });
      }

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  // ─── Private utilities ────────────────────────────────────────────────────

  /**
   * Build absolute remote path from relative path
   * Provides path traversal protection
   */
  private resolveRemotePath(relPath: string): string {
    // Normalize path separators to forward slashes
    const normalized = relPath.replace(/\\/g, '/');

    // Handle absolute paths (should not escape base)
    if (normalized.startsWith('/')) {
      const resolved = this.normalizePosixPath(normalized);
      // Security: ensure resolved path is within remotePath base
      if (!this.isWithinBase(resolved)) {
        throw new FileSystemError(
          'Path traversal detected: path escapes base directory',
          FileSystemErrorCodes.PATH_ESCAPE,
          relPath
        );
      }
      return resolved;
    }

    // Join with base path and normalize away any '.' segments (e.g. when relPath is '.')
    const joined = `${this.remotePath}/${normalized}`.replace(/\/+/g, '/');
    const fullPath = this.normalizePosixPath(joined);

    // Security: ensure path is within basePath
    if (!this.isWithinBase(fullPath)) {
      throw new FileSystemError(
        'Path traversal detected: path escapes base directory',
        FileSystemErrorCodes.PATH_ESCAPE,
        relPath
      );
    }

    return fullPath;
  }

  /** Normalize POSIX path segments the same way the remote shell resolves them. */
  private normalizePosixPath(p: string): string {
    return pathPosix.normalize(p.replace(/\/+/g, '/'));
  }

  /**
   * Check if a path is within the base directory
   */
  private isWithinBase(fullPath: string): boolean {
    // Normalize both paths
    const normalizedPath = fullPath.replace(/\/+/g, '/').replace(/\/$/, '');
    const normalizedBase = this.remotePath.replace(/\/+/g, '/').replace(/\/$/, '');

    // Path must start with base path
    return normalizedPath === normalizedBase || normalizedPath.startsWith(`${normalizedBase}/`);
  }

  /**
   * Get relative path from full remote path
   */
  private relativePath(fullPath: string): string {
    const normalized = fullPath.replace(/\\/g, '/').replace(/\/+/g, '/');
    const normalizedBase = normalizeRemoteBasePath(this.remotePath);

    if (normalized === normalizedBase) {
      return '';
    }

    const prefix = normalizedBase === '/' ? '/' : `${normalizedBase}/`;
    if (normalized.startsWith(prefix)) {
      return normalized.substring(prefix.length);
    }

    return normalized;
  }

  /**
   * Recursively ensure a remote directory exists
   */
  private async ensureRemoteDir(sftp: SFTPWrapper, dirPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      sftp.mkdir(dirPath, (err) => {
        if (!err) {
          resolve();
          return;
        }

        const sftpErr = err as SftpError;
        const msg = sftpErr.message ?? '';
        const lowerMsg = msg.toLowerCase();
        const code = sftpErr.code;

        const isAlreadyExists =
          lowerMsg.includes('already exists') ||
          lowerMsg.includes('file exists') ||
          (code === SFTP_STATUS.FAILURE && (msg === 'Failure' || msg === ''));
        const isMissingParent =
          code === SFTP_STATUS.NO_SUCH_FILE || lowerMsg.includes('no such file');

        if (isAlreadyExists) {
          resolve();
          return;
        }

        const parentPath = dirPath.substring(0, dirPath.lastIndexOf('/'));
        if (
          isMissingParent &&
          parentPath &&
          parentPath !== dirPath &&
          parentPath.length >= this.remotePath.length
        ) {
          this.ensureRemoteDir(sftp, parentPath)
            .then(() => this.ensureRemoteDir(sftp, dirPath))
            .then(resolve)
            .catch(reject);
        } else {
          reject(this.mapSftpError(err, dirPath));
        }
      });
    });
  }

  /**
   * Map SFTP error codes to FileSystemError
   */
  private mapSftpError(error: unknown, path?: string): FileSystemError {
    const sftpErr = error as SftpError;
    const message = typeof sftpErr?.message === 'string' ? sftpErr.message : String(error);
    const code = sftpErr?.code;

    // Map common SFTP error codes
    if (code === SFTP_STATUS.NO_SUCH_FILE || message.includes('No such file')) {
      return new FileSystemError(
        `File or directory not found: ${path || message}`,
        FileSystemErrorCodes.NOT_FOUND,
        path
      );
    }

    if (code === SFTP_STATUS.PERMISSION_DENIED || message.includes('Permission denied')) {
      return new FileSystemError(
        `Permission denied: ${path || message}`,
        FileSystemErrorCodes.PERMISSION_DENIED,
        path
      );
    }

    if (message.includes('is a directory')) {
      return new FileSystemError(
        `Path is a directory: ${path || message}`,
        FileSystemErrorCodes.IS_DIRECTORY,
        path
      );
    }

    if (message.includes('Not a directory')) {
      return new FileSystemError(
        `Path is not a directory: ${path || message}`,
        FileSystemErrorCodes.NOT_DIRECTORY,
        path
      );
    }

    if (message.includes('connection') || message.includes('Connection')) {
      return new FileSystemError(
        `Connection error: ${message}`,
        FileSystemErrorCodes.CONNECTION_ERROR,
        path
      );
    }

    // Default to unknown error
    return new FileSystemError(`Filesystem error: ${message}`, FileSystemErrorCodes.UNKNOWN, path);
  }

  watch(
    callback: (events: FileWatchEvent[]) => void,
    options: { debounceMs?: number } = {}
  ): FileWatcher {
    const interval = options.debounceMs ?? 4000;
    let watched: string[] = [];
    // Map from dirPath → previous entries (keyed by relative entry path)
    const snapshots = new Map<string, Map<string, FileEntry>>();

    const poll = async () => {
      for (const dirPath of watched) {
        let result: FileListResult | null = null;
        try {
          result = await this.list(dirPath, { includeHidden: true });
        } catch {
          continue;
        }

        const currMap = new Map(result.entries.map((e) => [e.path, e]));
        const prevMap = snapshots.get(dirPath);
        snapshots.set(dirPath, currMap);

        if (!prevMap) continue;

        const evts: FileWatchEvent[] = [];
        for (const [p, e] of currMap) {
          const prev = prevMap.get(p);
          if (!prev)
            evts.push({
              type: 'create',
              entryType: fileWatchEntryType(e),
              path: p,
            });
          else if (fileEntryMetadataChanged(prev, e))
            evts.push({
              type: 'modify',
              entryType: fileWatchEntryType(e),
              path: p,
            });
        }
        for (const [p, e] of prevMap) {
          if (!currMap.has(p))
            evts.push({
              type: 'delete',
              entryType: fileWatchEntryType(e),
              path: p,
            });
        }
        if (evts.length) callback(evts);
      }
    };

    const timer = setInterval(() => {
      void poll();
    }, interval);

    return {
      update(paths: string[]) {
        watched = paths;
        for (const p of snapshots.keys()) {
          if (!paths.includes(p)) snapshots.delete(p);
        }
      },
      close() {
        clearInterval(timer);
      },
    };
  }
}

function normalizeRemoteBasePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+/g, '/');
  if (normalized === '/') return '/';
  return normalized.replace(/\/$/, '');
}
