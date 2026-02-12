/**
 * Filesystem Abstraction Layer
 *
 * Provides unified interface for local and remote (SSH/SFTP) filesystem operations.
 * This module is part of Wave 1 (interfaces and structure).
 *
 * Wave 2 will implement:
 * - LocalFileSystem: wrapping existing fsIpc functionality
 * - RemoteFileSystem: SFTP-based implementation using ssh2
 * - FileSystemFactory: factory pattern for creating appropriate FS instances
 *
 * Usage:
 *   import { FileSystemFactory, IFileSystem } from './services/fs';
 *
 *   const fs: IFileSystem = FileSystemFactory.create(project);
 *   const result = await fs.read('src/index.ts');
 */

// Types and interfaces
export type {
  IFileSystem,
  FileEntry,
  ListOptions,
  FileListResult,
  ReadResult,
  WriteResult,
  SearchOptions,
  SearchResult,
  SearchMatch,
} from './types';

export { FileSystemError, FileSystemErrorCodes } from './types';

// Implementations (stubs in Wave 1)
export { LocalFileSystem } from './LocalFileSystem';
export { RemoteFileSystem } from './RemoteFileSystem';
export { FileSystemFactory } from './FileSystemFactory';
