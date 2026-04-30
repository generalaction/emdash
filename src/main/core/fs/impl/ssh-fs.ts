/**
 * Remote FileSystem implementation
 * Uses SFTP over SSH for remote filesystem operations
 */

import type { SFTPWrapper } from 'ssh2';
import type { FileWatchEvent } from '@shared/fs';
import type { SshClientProxy } from '@main/core/ssh/ssh-client-proxy';
import { log } from '@main/lib/logger';
import { quoteShellArg } from '@main/utils/shellEscape';
import {
  DEFAULT_EMDASH_CONFIG,
  FileSystemError,
  FileSystemErrorCodes,
  type FileEntry,
  type FileListResult,
  type FileSystemProvider,
  type FileWatcher,
  type ListOptions,
  type ReadResult,
  type SearchMatch,
  type SearchOptions,
  type SearchResult,
  type WriteResult,
} from '../types';

const SFTP_STATUS = {
  NO_SUCH_FILE: 2,
  PERMISSION_DENIED: 3,
  FAILURE: 4,
} as const;

interface SftpError extends Error {
  code?: number;
}

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
 * SshFileSystem implements IFileSystem using SFTP over SSH.
 * Provides path traversal protection and proper error handling.
 */
export class SshFileSystem implements FileSystemProvider {
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
      this.proxy.client.sftp((err, sftp) => {
        if (err) return reject(err);
        this.cachedSftp = sftp;
        sftp.on('close', () => {
          this.cachedSftp = undefined;
        });
        resolve(sftp);
      });
    });
  }

  private exec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const full = `bash -l -c ${quoteShellArg(command)}`;
    return new Promise((resolve, reject) => {
      this.proxy.client.exec(full, (err, stream) => {
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
   * Recursively list all files and directories via SSH find (single round-trip).
   * Returns items in the same {path, type} format used by the local fs:list handler.
   */
  async listRecursive(options?: { includeDirs?: boolean; maxEntries?: number }): Promise<{
    items: Array<{ path: string; type: 'file' | 'dir' }>;
    truncated: boolean;
  }> {
    const includeDirs = options?.includeDirs ?? true;
    const maxEntries = options?.maxEntries ?? 5000;

    // Directories to prune from the listing
    const pruneNames = [
      '.git',
      'node_modules',
      'dist',
      'build',
      '.next',
      'out',
      '.turbo',
      'coverage',
      '.nyc_output',
      '.cache',
      'tmp',
      'temp',
      '__pycache__',
      '.pytest_cache',
      'venv',
      '.venv',
      'target',
      '.terraform',
      '.serverless',
      'vendor',
      'bower_components',
      'worktrees',
      '.worktrees',
      '.DS_Store',
    ];

    // Build prune clause for find (names are hardcoded, but escape for safety)
    const pruneExpr = pruneNames.map((name) => `-name ${quoteShellArg(name)}`).join(' -o ');

    // Build find command: prune ignored dirs, print files (and optionally dirs)
    const typeFilter = includeDirs ? '' : '-type f';
    const command = [
      `find ${quoteShellArg(this.remotePath)}`,
      `\\( ${pruneExpr} \\) -prune -o`,
      typeFilter ? `${typeFilter} -print` : '-print',
      `2>/dev/null`,
      `| head -n ${maxEntries + 1}`,
    ]
      .filter(Boolean)
      .join(' ');

    try {
      const result = await this.exec(command);

      const lines = result.stdout.split('\n').filter((line) => line.trim());

      // Check if we exceeded maxEntries (we asked for maxEntries+1 to detect truncation)
      const truncated = lines.length > maxEntries;
      const effectiveLines = truncated ? lines.slice(0, maxEntries) : lines;

      const items: Array<{ path: string; type: 'file' | 'dir' }> = [];

      for (const line of effectiveLines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Skip the root path itself
        if (trimmed === this.remotePath || trimmed === this.remotePath + '/') continue;

        const relPath = this.relativePath(trimmed);
        if (!relPath) continue;

        // Determine type: find outputs directories with trailing / when using -print,
        // but standard find doesn't. We'll use a heuristic: if any other entry starts
        // with this path + '/', it's a directory. For efficiency, detect trailing slash.
        const isDir = trimmed.endsWith('/');
        const cleanRel = relPath.replace(/\/$/, '');

        if (!cleanRel) continue;

        items.push({
          path: cleanRel,
          type: isDir ? 'dir' : 'file',
        });
      }

      // Since `find` doesn't always indicate directories clearly with just -print,
      // we do a second pass: any path that is a prefix of another path is a directory.
      const pathSet = new Set(items.map((i) => i.path));
      for (const item of items) {
        if (item.type === 'file') {
          // Check if any other path starts with this path + '/'
          const prefix = item.path + '/';
          for (const otherPath of pathSet) {
            if (otherPath.startsWith(prefix)) {
              item.type = 'dir';
              break;
            }
          }
        }
      }

      // Filter out dirs if not requested
      const finalItems = includeDirs ? items : items.filter((i) => i.type === 'file');

      return { items: finalItems, truncated };
    } catch {
      return { items: [], truncated: false };
    }
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

  async copyLocalFile(localAbsPath: string, destRelPath: string): Promise<void> {
    const sftp = await this.getSftp();
    const remoteFull = this.resolveRemotePath(destRelPath);
    await new Promise<void>((resolve, reject) => {
      sftp.fastPut(localAbsPath, remoteFull, (e) => (e ? reject(e) : resolve()));
    });
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
   * Search for content in files via SSH exec (grep)
   * Uses grep on the remote host for better performance on large codebases
   */
  async search(query: string, options?: SearchOptions): Promise<SearchResult> {
    const searchPattern = options?.pattern || query;
    const basePath = this.remotePath;
    const maxResults = options?.maxResults || 10000;
    const caseFlag = options?.caseSensitive ? '' : '-i';

    // Build grep command with shell-safe escaping
    const escapedPattern = quoteShellArg(searchPattern);

    // Build file extension filter if provided
    let includeFilter = '';
    if (options?.fileExtensions && options.fileExtensions.length > 0) {
      const extensions = options.fileExtensions.map((ext) =>
        ext.startsWith('.') ? ext : `.${ext}`
      );
      includeFilter = extensions.map((e) => `--include=${quoteShellArg(`*${e}`)}`).join(' ');
    }

    // Use grep recursively with line numbers
    const command = `grep -rn ${caseFlag} ${includeFilter} -e ${escapedPattern} ${quoteShellArg(basePath)} 2>/dev/null | head -n ${maxResults}`;

    try {
      const result = await this.exec(command);

      // If grep returns non-zero exit but no stderr, it just means no matches
      if (result.exitCode !== 0 && result.exitCode !== 1) {
        // grep exit code 1 means no matches found, which is fine
        return { matches: [], total: 0, filesSearched: 0 };
      }

      const matches: SearchMatch[] = [];
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
      log.error('Failed to search', { query, options, error });
      // If command execution fails, return empty results
      return { matches: [], total: 0, filesSearched: 0 };
    }
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

          if (stats.size === 0) {
            sftp.close(handle, () => {});
            resolve({ success: false, error: 'Image file is empty' });
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
   * Read (or auto-create) the project's .emdash.json config file via SFTP
   */
  async getProjectConfig(): Promise<{ success: boolean; content?: string; error?: string }> {
    try {
      const result = await this.read('.emdash.json').catch(async (err: unknown) => {
        const code = (err as FileSystemError).code;
        if (code !== FileSystemErrorCodes.NOT_FOUND) throw err;
        // File doesn't exist — create with defaults then return defaults
        await this.write('.emdash.json', DEFAULT_EMDASH_CONFIG);
        return {
          content: DEFAULT_EMDASH_CONFIG,
          truncated: false,
          totalSize: Buffer.byteLength(DEFAULT_EMDASH_CONFIG),
        };
      });
      return { success: true, content: result.content };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Write the project's .emdash.json config file via SFTP after validating JSON
   */
  async saveProjectConfig(content: string): Promise<{ success: boolean; error?: string }> {
    try {
      JSON.parse(content);
    } catch {
      return { success: false, error: 'Invalid JSON format' };
    }
    try {
      await this.write('.emdash.json', content);
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
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

  /** Remove single-dot segments from a POSIX path (e.g. /a/./b → /a/b). */
  private normalizePosixPath(p: string): string {
    const parts = p.split('/');
    const out: string[] = [];
    for (const seg of parts) {
      if (seg === '.') continue;
      out.push(seg);
    }
    // Re-join and collapse any double slashes introduced by the filter
    return out.join('/').replace(/\/+/g, '/') || '/';
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
          resolve();
          return;
        }

        const sftpErr = err as SftpError;
        const msg = sftpErr.message ?? '';
        const code = sftpErr.code;

        const isAlreadyExists =
          msg.includes('already exists') ||
          msg.includes('File exists') ||
          (code === SFTP_STATUS.FAILURE && (msg === 'Failure' || msg === ''));
        const isMissingParent = code === SFTP_STATUS.NO_SUCH_FILE || msg.includes('No such file');

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
          if (!prevMap.has(p))
            evts.push({
              type: 'create',
              entryType: e.type === 'dir' ? 'directory' : 'file',
              path: p,
            });
        }
        for (const [p, e] of prevMap) {
          if (!currMap.has(p))
            evts.push({
              type: 'delete',
              entryType: e.type === 'dir' ? 'directory' : 'file',
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
