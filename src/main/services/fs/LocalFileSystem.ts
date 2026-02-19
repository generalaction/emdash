/**
 * Local FileSystem implementation
 * Wraps Node.js fs operations for local disk access with security and performance features
 */

import { promises as fs, createReadStream } from 'fs';
import type { Stats } from 'fs';
import { join, resolve, relative, dirname, extname, sep } from 'path';
import { createInterface } from 'readline';
import {
  IFileSystem,
  FileListResult,
  ReadResult,
  WriteResult,
  SearchResult,
  ListOptions,
  SearchOptions,
  FileEntry,
  SearchMatch,
  FileSystemError,
  FileSystemErrorCodes,
} from './types';
import { GitIgnoreParser } from '../../utils/gitIgnore';

// Binary file extensions to skip during search
const BINARY_EXTENSIONS = new Set([
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.ico',
  '.svg',
  '.mp3',
  '.mp4',
  '.avi',
  '.mov',
  '.wmv',
  '.flv',
  '.webm',
  '.zip',
  '.tar',
  '.gz',
  '.bz2',
  '.7z',
  '.rar',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.wasm',
  '.class',
  '.jar',
  '.pyc',
  '.o',
  '.a',
]);

// Directories to skip during search
const SEARCH_IGNORES = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  '.cache',
  '.parcel-cache',
]);

// Allowed image extensions for readImage
const ALLOWED_IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.ico',
]);

// MIME types for images
const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
};

export class LocalFileSystem implements IFileSystem {
  constructor(private projectPath: string) {
    if (!projectPath) {
      throw new FileSystemError('Project path is required', FileSystemErrorCodes.INVALID_PATH);
    }
    this.projectPath = resolve(projectPath);
  }

  /**
   * Resolve and validate a relative path, ensuring it doesn't escape the project root
   */
  private resolvePath(relPath: string): string {
    // Normalize the path and resolve it against project root
    const normalizedRelPath = relPath.replace(/\\/g, '/').replace(/^\//, '');
    const fullPath = resolve(join(this.projectPath, normalizedRelPath));

    // Security: ensure path is within projectPath (handle trailing separator edge cases)
    const projectPathWithSep = this.projectPath.endsWith(sep)
      ? this.projectPath
      : this.projectPath + sep;
    const fullPathWithSep = fullPath.endsWith(sep) ? fullPath : fullPath + sep;

    if (!fullPathWithSep.startsWith(projectPathWithSep) && fullPath !== this.projectPath) {
      throw new FileSystemError(
        `Path traversal detected: ${relPath}`,
        FileSystemErrorCodes.PATH_ESCAPE,
        relPath
      );
    }

    return fullPath;
  }

  /**
   * Get relative path from absolute path
   */
  private relPath(fullPath: string): string {
    return relative(this.projectPath, fullPath);
  }

  /**
   * Check if a path should be ignored during search
   */
  private shouldIgnore(name: string): boolean {
    return SEARCH_IGNORES.has(name);
  }

  /**
   * Check if file is binary by extension
   */
  private isBinaryFile(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase();
    return BINARY_EXTENSIONS.has(ext);
  }

  /**
   * Convert fs.Stats to FileEntry
   */
  private statToEntry(fullPath: string, stat: Stats): FileEntry {
    const relPath = this.relPath(fullPath);
    return {
      path: relPath,
      type: stat.isDirectory() ? 'dir' : 'file',
      size: stat.size,
      mtime: stat.mtime,
      ctime: stat.ctime,
      mode: stat.mode,
    };
  }

  async list(path: string = '', options: ListOptions = {}): Promise<FileListResult> {
    const startTime = Date.now();
    const fullPath = this.resolvePath(path);
    const entries: FileEntry[] = [];
    const maxEntries = options.maxEntries || 10000;
    const timeBudgetMs = options.timeBudgetMs || 30000;

    let truncated = false;
    let truncateReason: 'maxEntries' | 'timeBudget' | undefined;

    const listDir = async (dirPath: string, recursive: boolean) => {
      // Check time budget
      if (Date.now() - startTime > timeBudgetMs) {
        truncated = true;
        truncateReason = 'timeBudget';
        return;
      }

      // Check entry limit
      if (entries.length >= maxEntries) {
        truncated = true;
        truncateReason = 'maxEntries';
        return;
      }

      let items;
      try {
        items = await fs.readdir(dirPath, { withFileTypes: true });
      } catch (err) {
        // Skip directories we can't read
        return;
      }

      for (const item of items) {
        // Check time budget periodically
        if (entries.length % 100 === 0 && Date.now() - startTime > timeBudgetMs) {
          truncated = true;
          truncateReason = 'timeBudget';
          return;
        }

        // Skip hidden files if not included
        if (!options.includeHidden && item.name.startsWith('.')) {
          continue;
        }

        // Skip ignored directories
        if (this.shouldIgnore(item.name)) {
          continue;
        }

        const itemPath = join(dirPath, item.name);

        try {
          const stat = await fs.stat(itemPath);
          const entry: FileEntry = {
            path: this.relPath(itemPath),
            type: item.isDirectory() ? 'dir' : 'file',
            size: stat.size,
            mtime: stat.mtime,
            ctime: stat.ctime,
            mode: stat.mode,
          };

          // Apply filter if specified
          if (options.filter) {
            const filterRegex = new RegExp(options.filter);
            if (!filterRegex.test(item.name)) {
              continue;
            }
          }

          entries.push(entry);

          // Check entry limit
          if (entries.length >= maxEntries) {
            truncated = true;
            truncateReason = 'maxEntries';
            return;
          }

          // Recurse into subdirectories
          if (recursive && item.isDirectory()) {
            await listDir(itemPath, true);
          }
        } catch {
          // Skip entries we can't stat
        }
      }
    };

    await listDir(fullPath, options.recursive || false);

    return {
      entries,
      total: entries.length,
      truncated,
      truncateReason,
      durationMs: Date.now() - startTime,
    };
  }

  async read(path: string, maxBytes: number = 200 * 1024): Promise<ReadResult> {
    const fullPath = this.resolvePath(path);

    let stat;
    try {
      stat = await fs.stat(fullPath);
    } catch (err) {
      throw new FileSystemError(`File not found: ${path}`, FileSystemErrorCodes.NOT_FOUND, path);
    }

    if (stat.isDirectory()) {
      throw new FileSystemError(
        `Path is a directory: ${path}`,
        FileSystemErrorCodes.IS_DIRECTORY,
        path
      );
    }

    // Handle large files with truncation
    if (stat.size > maxBytes) {
      const fd = await fs.open(fullPath, 'r');
      try {
        const buffer = Buffer.alloc(maxBytes);
        await fd.read(buffer, 0, maxBytes, 0);

        return {
          content: buffer.toString('utf-8'),
          truncated: true,
          totalSize: stat.size,
        };
      } finally {
        await fd.close();
      }
    }

    const content = await fs.readFile(fullPath, 'utf-8');
    return {
      content,
      truncated: false,
      totalSize: stat.size,
    };
  }

  async write(path: string, content: string): Promise<WriteResult> {
    const fullPath = this.resolvePath(path);

    // Ensure directory exists
    const dir = dirname(fullPath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (err) {
      throw new FileSystemError(
        `Failed to create directory: ${dir}`,
        FileSystemErrorCodes.PERMISSION_DENIED,
        path
      );
    }

    try {
      await fs.writeFile(fullPath, content, 'utf-8');
    } catch (err) {
      throw new FileSystemError(
        `Failed to write file: ${path}`,
        FileSystemErrorCodes.PERMISSION_DENIED,
        path
      );
    }

    const stat = await fs.stat(fullPath);
    return {
      success: true,
      bytesWritten: stat.size,
    };
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fs.access(this.resolvePath(path));
      return true;
    } catch {
      return false;
    }
  }

  async stat(path: string): Promise<FileEntry | null> {
    try {
      const fullPath = this.resolvePath(path);
      const stat = await fs.stat(fullPath);
      return this.statToEntry(fullPath, stat);
    } catch {
      return null;
    }
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult> {
    const pattern = options.pattern || query;
    const startTime = Date.now();
    const matches: SearchMatch[] = [];
    const maxResults = options.maxResults || 100;
    const fileExtensions = options.fileExtensions;
    const caseSensitive = options.caseSensitive ?? false;

    let filesSearched = 0;
    let truncated = false;

    const searchRegex = caseSensitive
      ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    let gitIgnore: GitIgnoreParser | undefined;
    try {
      const gitIgnorePath = join(this.projectPath, '.gitignore');
      const content = await fs.readFile(gitIgnorePath, 'utf-8');
      gitIgnore = new GitIgnoreParser(content);
    } catch {
      // Ignore error reading .gitignore
    }

    const searchDir = async (dirPath: string) => {
      let items;
      try {
        items = await fs.readdir(dirPath, { withFileTypes: true });
      } catch {
        return;
      }

      for (const item of items) {
        if (matches.length >= maxResults) {
          truncated = true;
          return;
        }

        const itemPath = join(dirPath, item.name);

        if (item.isDirectory()) {
          const relPath = this.relPath(itemPath);
          if (gitIgnore && gitIgnore.ignores(relPath)) {
            continue;
          }

          if (!this.shouldIgnore(item.name) && !item.name.startsWith('.')) {
            await searchDir(itemPath);
          }
        } else if (item.isFile()) {
          // Skip binary files
          if (this.isBinaryFile(itemPath)) {
            continue;
          }

          // Check file extension filter
          if (fileExtensions && fileExtensions.length > 0) {
            const ext = extname(item.name).toLowerCase();
            if (
              !fileExtensions.some((e) => ext === e.toLowerCase() || ext === `.${e.toLowerCase()}`)
            ) {
              continue;
            }
          }

          // Check file pattern if specified
          if (options.filePattern) {
            const filePatternRegex = new RegExp(options.filePattern.replace(/\*/g, '.*'));
            if (!filePatternRegex.test(item.name)) {
              continue;
            }
          }

          filesSearched++;

          try {
            const fileStream = createReadStream(itemPath, { encoding: 'utf-8' });
            const rl = createInterface({
              input: fileStream,
              crlfDelay: Infinity,
            });

            let lineNum = 0;
            for await (const line of rl) {
              lineNum++;

              // Check for null bytes (binary file indicator)
              if (line.includes('\0')) {
                fileStream.destroy();
                break;
              }

              const matchResult = caseSensitive
                ? line.includes(pattern)
                : line.toLowerCase().includes(pattern.toLowerCase());

              if (matchResult) {
                const column =
                  (caseSensitive
                    ? line.indexOf(pattern)
                    : line.toLowerCase().indexOf(pattern.toLowerCase())) + 1;

                matches.push({
                  filePath: this.relPath(itemPath),
                  line: lineNum,
                  column,
                  content: line.trim(),
                  preview: line.trim().substring(0, 200),
                });

                if (matches.length >= maxResults) {
                  fileStream.destroy();
                  truncated = true;
                  return;
                }
              }
            }
          } catch {
            // Skip files that can't be read
          }
        }
      }
    };

    await searchDir(this.projectPath);

    return {
      matches,
      total: matches.length,
      truncated,
      filesSearched,
    };
  }

  async remove(path: string): Promise<{ success: boolean; error?: string }> {
    const fullPath = this.resolvePath(path);

    let stat;
    try {
      stat = await fs.stat(fullPath);
    } catch {
      return { success: false, error: `File not found: ${path}` };
    }

    if (stat.isDirectory()) {
      return { success: false, error: `Path is a directory: ${path}` };
    }

    try {
      await fs.unlink(fullPath);
      return { success: true };
    } catch (err: any) {
      // Attempt chmod retry on permission error
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        try {
          await fs.chmod(fullPath, 0o666);
          await fs.unlink(fullPath);
          return { success: true };
        } catch {
          return { success: false, error: `Permission denied: ${path}` };
        }
      }
      return { success: false, error: err.message };
    }
  }

  async readImage(path: string): Promise<{
    success: boolean;
    dataUrl?: string;
    mimeType?: string;
    size?: number;
    error?: string;
  }> {
    const fullPath = this.resolvePath(path);

    // Check file extension
    const ext = extname(path).toLowerCase();
    if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
      return {
        success: false,
        error: `Unsupported image format: ${ext}. Allowed: ${Array.from(ALLOWED_IMAGE_EXTENSIONS).join(', ')}`,
      };
    }

    let stat;
    try {
      stat = await fs.stat(fullPath);
    } catch {
      return { success: false, error: `Image not found: ${path}` };
    }

    if (stat.isDirectory()) {
      return { success: false, error: `Path is a directory: ${path}` };
    }

    // Size limit for images (10MB)
    const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
    if (stat.size > MAX_IMAGE_SIZE) {
      return {
        success: false,
        error: `Image too large: ${stat.size} bytes (max ${MAX_IMAGE_SIZE})`,
      };
    }

    try {
      const buffer = await fs.readFile(fullPath);
      const base64 = buffer.toString('base64');
      const mimeType = IMAGE_MIME_TYPES[ext] || 'application/octet-stream';
      const dataUrl = `data:${mimeType};base64,${base64}`;

      return {
        success: true,
        dataUrl,
        mimeType,
        size: stat.size,
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
