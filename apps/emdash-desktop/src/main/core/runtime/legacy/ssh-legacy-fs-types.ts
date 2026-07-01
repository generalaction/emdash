/**
 * Filesystem abstraction layer types
 * Provides unified interface for local and remote (SSH/SFTP) filesystem operations
 */
import type { FileSymlinkInfo } from '@emdash/core/files';

/**
 * Transitional SSH polling watcher handle.
 *
 * Runtime-owned file change feeds use this internally for the temporary SSH
 * adapter; the renderer-facing legacy watch RPC has been removed.
 */
export interface FileWatcher {
  update(paths: string[]): void;
  close(): void;
}

/**
 * File entry metadata returned by filesystem operations
 */
export interface FileEntry {
  /** Relative path from the project root */
  path: string;
  /** Entry type - file or directory */
  type: 'file' | 'dir' | 'symlink';
  /** Symlink target metadata when type is symlink */
  symlink?: FileSymlinkInfo;
  /** File size in bytes (files only) */
  size?: number;
  /** Last modification time */
  mtime?: Date;
  /** Creation time */
  ctime?: Date;
  /** File permissions (Unix mode) */
  mode?: number;
}

/**
 * Options for listing directory contents
 */
export interface ListOptions {
  /** Include entries from subdirectories recursively */
  recursive?: boolean;
  /** Include hidden files (starting with .) */
  includeHidden?: boolean;
  /** Filter pattern (glob or regex, implementation-dependent) */
  filter?: string;
  /** Maximum number of entries to return */
  maxEntries?: number;
  /** Time budget in milliseconds */
  timeBudgetMs?: number;
}

/**
 * Result of a list operation
 */
export interface FileListResult {
  /** File and directory entries */
  entries: FileEntry[];
  /** Total number of entries found (may be more than entries.length if truncated) */
  total: number;
  /** Whether the result was truncated due to limits */
  truncated?: boolean;
  /** Reason for truncation if applicable */
  truncateReason?: 'maxEntries' | 'timeBudget';
  /** Duration of the operation in milliseconds */
  durationMs?: number;
}

/**
 * Result of a file read operation
 */
export interface ReadResult {
  /** File content as string */
  content: string;
  /** Whether the content was truncated due to maxBytes limit */
  truncated: boolean;
  /** Total file size in bytes */
  totalSize: number;
}

/**
 * Result of a file write operation
 */
export interface WriteResult {
  /** Whether the write was successful */
  success: boolean;
  /** Number of bytes written */
  bytesWritten: number;
  /** Error message if unsuccessful */
  error?: string;
}

/**
 * Legacy workspace filesystem abstraction.
 *
 * This provider remains active for non-tree workspace file operations
 * (read/write/glob/copy/config watches/project setup). Do not extend it
 * for the editor file tree; file-tree reads, scopes, and deltas live in
 * `@emdash/core/files` and are exposed through `workspace.fileTree`.
 *
 * Longer term this desktop-side provider should disappear behind filesystem APIs
 * owned by `@emdash/core`. Those APIs should run where the workspace lives and
 * call `node:fs` directly: desktop imports core directly for local projects,
 * while the workspace server imports the same core API and exposes it to
 * desktop for remote projects.
 */
export interface LegacySshFileOperations {
  /**
   * List directory contents
   * @param path - Directory path relative to project root
   * @param options - Listing options
   * @returns Promise resolving to file list result
   */
  list(path: string, options?: ListOptions): Promise<FileListResult>;

  /**
   * Read file contents
   * @param path - File path relative to project root
   * @param maxBytes - Maximum bytes to read (default: 200KB)
   * @returns Promise resolving to read result
   */
  read(path: string, maxBytes?: number): Promise<ReadResult>;

  /**
   * Write file contents
   * @param path - File path relative to project root
   * @param content - Content to write
   * @returns Promise resolving to write result
   */
  write(path: string, content: string): Promise<WriteResult>;

  /**
   * Check if a path exists
   * @param path - Path to check relative to project root
   * @returns Promise resolving to true if exists
   */
  exists(path: string): Promise<boolean>;

  /**
   * Get file/directory metadata
   * @param path - Path to stat relative to project root
   * @returns Promise resolving to file entry or null if not found
   */
  stat(path: string): Promise<FileEntry | null>;

  /**
   * Remove a file or directory.
   * @param path - Path relative to project root
   * @param options - Pass `{ recursive: true }` to remove directories and all contents
   * @returns Promise resolving to success status
   */
  remove(
    path: string,
    options?: { recursive?: boolean }
  ): Promise<{ success: boolean; error?: string }>;

  /**
   * Resolve a path to its absolute, canonical form (resolving symlinks).
   * @param path - Path relative to project root
   * @returns Promise resolving to the absolute path
   */
  realPath(path: string): Promise<string>;

  /**
   * Find files matching a glob pattern.
   * @param pattern - Glob pattern (e.g., ".env", ".env.*.local")
   * @param options - cwd: directory to search in; dot: include dotfiles (default false)
   * @returns Relative paths of matching entries
   */
  glob(pattern: string, options?: { cwd?: string; dot?: boolean }): Promise<string[]>;

  /**
   * Copy a file from src to dest (both paths relative to project root).
   * Does not create parent directories — caller must ensure they exist.
   * @param src - Source path
   * @param dest - Destination path
   */
  copyFile(src: string, dest: string): Promise<void>;

  mkdir(diPath: string, options?: { recursive?: boolean }): Promise<void>;
}

/**
 * Base error class for filesystem operations
 */
export class FileSystemError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly path?: string
  ) {
    super(message);
    this.name = 'FileSystemError';
  }
}

/**
 * Error codes for filesystem operations
 */
export const FileSystemErrorCodes = {
  PATH_ESCAPE: 'PATH_ESCAPE',
  NOT_FOUND: 'NOT_FOUND',
  IS_DIRECTORY: 'IS_DIRECTORY',
  NOT_DIRECTORY: 'NOT_DIRECTORY',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  INVALID_PATH: 'INVALID_PATH',
  CONNECTION_ERROR: 'CONNECTION_ERROR',
  TIMEOUT: 'TIMEOUT',
  UNKNOWN: 'UNKNOWN',
} as const;
