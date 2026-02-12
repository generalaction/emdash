/**
 * Filesystem abstraction layer types
 * Provides unified interface for local and remote (SSH/SFTP) filesystem operations
 */

/**
 * File entry metadata returned by filesystem operations
 */
export interface FileEntry {
  /** Relative path from the project root */
  path: string;
  /** Entry type - file or directory */
  type: 'file' | 'dir';
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
 * Options for search operations
 */
export interface SearchOptions {
  /**
   * Optional override pattern. If omitted, the `query` argument to `IFileSystem.search()` is used.
   */
  pattern?: string;
  /** Optional file pattern filter (e.g., "*.ts") */
  filePattern?: string;
  /** Maximum number of results to return */
  maxResults?: number;
  /** Case-sensitive search */
  caseSensitive?: boolean;
  /** File extensions to include */
  fileExtensions?: string[];
}

/**
 * Result of a search operation
 */
export interface SearchResult {
  /** Search matches found */
  matches: SearchMatch[];
  /** Total number of matches */
  total: number;
  /** Whether results were truncated */
  truncated?: boolean;
  /** Number of files searched */
  filesSearched?: number;
}

/**
 * Individual search match
 */
export interface SearchMatch {
  /** Path to the file containing the match */
  filePath: string;
  /** Line number (1-based) */
  line: number;
  /** Column number (1-based) */
  column: number;
  /** Match text */
  content: string;
  /** Preview with context */
  preview?: string;
}

/**
 * Filesystem interface abstraction
 * Implementations: LocalFileSystem (local disk), RemoteFileSystem (SFTP over SSH)
 */
export interface IFileSystem {
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
   * Search for content in files
   * @param query - Search query string
   * @param options - Search options
   * @returns Promise resolving to search results
   */
  search(query: string, options?: SearchOptions): Promise<SearchResult>;

  /**
   * Remove a file
   * @param path - File path relative to project root
   * @returns Promise resolving to success status
   */
  remove?(path: string): Promise<{ success: boolean; error?: string }>;

  /**
   * Read image file as base64 data URL
   * @param path - Image file path relative to project root
   * @returns Promise resolving to image data
   */
  readImage?(path: string): Promise<{
    success: boolean;
    dataUrl?: string;
    mimeType?: string;
    size?: number;
    error?: string;
  }>;
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
