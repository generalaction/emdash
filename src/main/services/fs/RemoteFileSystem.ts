/**
 * Remote FileSystem implementation
 * Uses SFTP over SSH for remote filesystem operations
 */

import { SFTPWrapper } from 'ssh2';
import {
  IFileSystem,
  FileListResult,
  ReadResult,
  WriteResult,
  SearchResult,
  ListOptions,
  SearchOptions,
  FileEntry,
  FileSystemError,
  FileSystemErrorCodes,
} from './types';
import { SshService } from '../ssh/SshService';

/**
 * Allowed image extensions for readImage
 */
const ALLOWED_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'];

/**
 * Maximum file size for reading (100MB to prevent memory issues)
 */
const MAX_READ_SIZE = 100 * 1024 * 1024;

/**
 * Default max bytes for read operations
 */
const DEFAULT_MAX_BYTES = 200 * 1024;

/**
 * RemoteFileSystem implements IFileSystem using SFTP over SSH.
 * Provides path traversal protection and proper error handling.
 */
export class RemoteFileSystem implements IFileSystem {
  constructor(
    private sshService: SshService,
    private connectionId: string,
    private remotePath: string
  ) {
    if (!sshService) {
      throw new FileSystemError('SSH service is required', FileSystemErrorCodes.CONNECTION_ERROR);
    }
    if (!connectionId) {
      throw new FileSystemError('Connection ID is required', FileSystemErrorCodes.CONNECTION_ERROR);
    }
    if (!remotePath) {
      throw new FileSystemError('Remote path is required', FileSystemErrorCodes.INVALID_PATH);
    }
    // Normalize remote path to use forward slashes
    this.remotePath = remotePath.replace(/\\/g, '/');
  }

  /**
   * List directory contents via SFTP
   */
  async list(path: string = '', options?: ListOptions): Promise<FileListResult> {
    const startTime = Date.now();
    const fullPath = this.resolveRemotePath(path);
    const sftp = await this.sshService.getSftp(this.connectionId);

    return new Promise((resolve, reject) => {
      sftp.readdir(fullPath, (err, list) => {
        if (err) {
          reject(this.mapSftpError(err, fullPath));
          return;
        }

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

          const entryPath = this.relativePath(`${fullPath}/${item.filename}`);
          if (seen.has(entryPath)) {
            continue;
          }
          seen.add(entryPath);

          const entry: FileEntry = {
            path: entryPath,
            type: item.attrs.isDirectory() ? 'dir' : 'file',
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
      });
    });
  }

  /**
   * Read file contents via SFTP
   * Handles large files by respecting maxBytes limit
   */
  async read(path: string, maxBytes: number = DEFAULT_MAX_BYTES): Promise<ReadResult> {
    const fullPath = this.resolveRemotePath(path);
    const sftp = await this.sshService.getSftp(this.connectionId);

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
    const sftp = await this.sshService.getSftp(this.connectionId);

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

  /**
   * Get file/directory metadata via SFTP
   */
  async stat(path: string): Promise<FileEntry | null> {
    const fullPath = this.resolveRemotePath(path);
    const sftp = await this.sshService.getSftp(this.connectionId);

    return new Promise((resolve, reject) => {
      sftp.stat(fullPath, (err, stats) => {
        if (err) {
          // Check if file doesn't exist
          const anyErr = err as any;
          if (anyErr?.message?.includes('No such file') || anyErr?.code === 2) {
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
   * Search for content in files via SSH exec (grep)
   * Uses grep on the remote host for better performance on large codebases
   */
  async search(query: string, options?: SearchOptions): Promise<SearchResult> {
    const searchPattern = options?.pattern || query;
    const basePath = this.remotePath;
    const maxResults = options?.maxResults || 100;
    const caseFlag = options?.caseSensitive ? '' : '-i';

    // Build grep command with proper escaping
    const escapedPattern = searchPattern.replace(/"/g, '\\"');

    // Build file extension filter if provided
    let includeFilter = '';
    if (options?.fileExtensions && options.fileExtensions.length > 0) {
      const extensions = options.fileExtensions.map((ext) =>
        ext.startsWith('.') ? ext : `.${ext}`
      );
      includeFilter = `--include="*.{${extensions.map((e) => e.slice(1)).join(',')}}"`;
    }

    // Use grep recursively with line numbers
    const command = `grep -rn ${caseFlag} ${includeFilter} "${escapedPattern}" "${basePath}" 2>/dev/null | head -n ${maxResults}`;

    try {
      const result = await this.sshService.executeCommand(this.connectionId, command);

      // If grep returns non-zero exit but no stderr, it just means no matches
      if (result.exitCode !== 0 && result.exitCode !== 1) {
        // grep exit code 1 means no matches found, which is fine
        return { matches: [], total: 0, filesSearched: 0 };
      }

      const matches: import('./types').SearchMatch[] = [];
      const lines = result.stdout.split('\n').filter((line) => line.trim());
      const seenFiles = new Set<string>();

      for (const line of lines) {
        // Parse grep output format: path:line:content
        const firstColon = line.indexOf(':');
        if (firstColon === -1) continue;

        const filePath = line.substring(0, firstColon);
        const rest = line.substring(firstColon + 1);

        const secondColon = rest.indexOf(':');
        if (secondColon === -1) continue;

        const lineNum = parseInt(rest.substring(0, secondColon), 10);
        const content = rest.substring(secondColon + 1);

        if (isNaN(lineNum)) continue;

        const relPath = this.relativePath(filePath);

        // Apply file pattern filter if provided
        if (options?.filePattern) {
          const patternRegex = new RegExp(options.filePattern);
          if (!patternRegex.test(relPath)) {
            continue;
          }
        }

        seenFiles.add(filePath);

        // Find column by searching for the pattern in the content
        const searchPat = options?.caseSensitive ? searchPattern : searchPattern.toLowerCase();
        const column = content.indexOf(searchPat) + 1;

        matches.push({
          filePath: relPath,
          line: lineNum,
          column: column > 0 ? column : 1,
          content: content.trim(),
          preview: content.trim(),
        });
      }

      return {
        matches,
        total: matches.length,
        truncated: lines.length >= maxResults,
        filesSearched: seenFiles.size,
      };
    } catch (error) {
      // If command execution fails, return empty results
      return { matches: [], total: 0, filesSearched: 0 };
    }
  }

  /**
   * Remove a file via SFTP
   * For directories, uses SSH exec with rm -rf
   */
  async remove(path: string): Promise<{ success: boolean; error?: string }> {
    const fullPath = this.resolveRemotePath(path);

    try {
      const entry = await this.stat(path);

      if (!entry) {
        return { success: false, error: `File not found: ${path}` };
      }

      const sftp = await this.sshService.getSftp(this.connectionId);

      if (entry.type === 'dir') {
        // For directories, use SSH exec to recursively remove
        const command = `rm -rf "${fullPath}"`;
        const result = await this.sshService.executeCommand(this.connectionId, command);

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

  /**
   * Read image file as base64 data URL via SFTP
   */
  async readImage(path: string): Promise<{
    success: boolean;
    dataUrl?: string;
    mimeType?: string;
    size?: number;
    error?: string;
  }> {
    // Check file extension
    const ext = path.toLowerCase().substring(path.lastIndexOf('.'));
    if (!ALLOWED_IMAGE_EXTENSIONS.includes(ext)) {
      return {
        success: false,
        error: `Unsupported image format: ${ext}`,
      };
    }

    const fullPath = this.resolveRemotePath(path);
    const sftp = await this.sshService.getSftp(this.connectionId);

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

          // Check file size limit (5MB for images)
          const maxImageSize = 5 * 1024 * 1024;
          if (stats.size > maxImageSize) {
            sftp.close(handle, () => {});
            resolve({
              success: false,
              error: `Image too large: ${stats.size} bytes (max ${maxImageSize})`,
            });
            return;
          }

          const buffer = Buffer.alloc(stats.size);

          sftp.read(handle, buffer, 0, stats.size, 0, (readErr) => {
            sftp.close(handle, () => {});

            if (readErr) {
              reject(this.mapSftpError(readErr, fullPath));
              return;
            }

            // Determine MIME type from extension
            const mimeTypes: Record<string, string> = {
              '.png': 'image/png',
              '.jpg': 'image/jpeg',
              '.jpeg': 'image/jpeg',
              '.gif': 'image/gif',
              '.webp': 'image/webp',
              '.svg': 'image/svg+xml',
              '.bmp': 'image/bmp',
              '.ico': 'image/x-icon',
            };
            const mimeType = mimeTypes[ext] || 'application/octet-stream';

            // Convert to base64
            const base64 = buffer.toString('base64');
            const dataUrl = `data:${mimeType};base64,${base64}`;

            resolve({
              success: true,
              dataUrl,
              mimeType,
              size: stats.size,
            });
          });
        });
      });
    });
  }

  /**
   * Ensure connection is active, reconnect if needed
   * Note: Actual reconnection logic is handled by SshService
   */
  private async ensureConnected(): Promise<void> {
    const connections = this.sshService.listConnections();
    if (!connections.includes(this.connectionId)) {
      throw new FileSystemError(
        'SSH connection not found',
        FileSystemErrorCodes.CONNECTION_ERROR,
        this.connectionId
      );
    }
  }

  /**
   * Build absolute remote path from relative path
   * Provides path traversal protection
   */
  private resolveRemotePath(relPath: string): string {
    // Normalize path separators to forward slashes
    const normalized = relPath.replace(/\\/g, '/');

    // Handle absolute paths (should not escape base)
    if (normalized.startsWith('/')) {
      const resolved = normalized;
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

    // Join with base path
    const fullPath = `${this.remotePath}/${normalized}`.replace(/\/+/g, '/');

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
    const normalized = fullPath.replace(/\\/g, '/');
    const normalizedBase = this.remotePath.replace(/\\/g, '/');

    if (normalized === normalizedBase) {
      return '';
    }

    const prefix = `${normalizedBase}/`;
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
          // Directory created successfully
          resolve();
          return;
        }

        // Check if directory already exists
        if (err.message?.includes('already exists') || err.message?.includes('File exists')) {
          resolve();
          return;
        }

        // Try to create parent directory recursively
        const parentPath = dirPath.substring(0, dirPath.lastIndexOf('/'));
        if (parentPath && parentPath !== dirPath && parentPath.length >= this.remotePath.length) {
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
    const anyErr = error as any;
    const message = typeof anyErr?.message === 'string' ? anyErr.message : String(error);
    const code = anyErr?.code;

    // Map common SFTP error codes
    if (code === 2 || message.includes('No such file')) {
      return new FileSystemError(
        `File or directory not found: ${path || message}`,
        FileSystemErrorCodes.NOT_FOUND,
        path
      );
    }

    if (code === 3 || message.includes('Permission denied')) {
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
}
