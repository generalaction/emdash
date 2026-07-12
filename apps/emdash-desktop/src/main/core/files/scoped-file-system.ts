import type { FsError, ReadFileOptions } from '@emdash/core/files';
import type { Result } from '@emdash/shared';

export type FileStat = {
  path: string;
  type: 'file' | 'directory';
  size: number;
  mtime: Date;
  ctime: Date;
  mode: number;
};

export type ReadTextResult = {
  content: string;
  truncated: boolean;
  totalSize: number;
  etag: string;
};

export type ReadBytesResult = {
  bytes: Uint8Array;
  truncated: boolean;
  totalSize: number;
  etag: string;
};

export type WriteFileResult = { bytesWritten: number };
export type FileExclusionPredicate = (absolutePath: string) => boolean;

export type FileUsage = {
  path: string;
  type: 'file' | 'directory';
  apparentBytes: number;
  diskBytes: number;
  exclusiveDiskBytes: number;
  errors: Array<{ path: string; message: string }>;
};

export interface ScopedFileSystem {
  readonly rootPath: string;
  readText(path: string, options?: ReadFileOptions): Promise<Result<ReadTextResult, FsError>>;
  readBytes(path: string, options?: ReadFileOptions): Promise<Result<ReadBytesResult, FsError>>;
  writeText(path: string, content: string): Promise<Result<WriteFileResult, FsError>>;
  writeBytes(path: string, bytes: Uint8Array): Promise<Result<WriteFileResult, FsError>>;
  stat(path: string): Promise<Result<FileStat, FsError>>;
  measureUsage(path: string): Promise<Result<FileUsage, FsError>>;
  exists(path: string): Promise<Result<boolean, FsError>>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<Result<void, FsError>>;
  remove(path: string, options?: { recursive?: boolean }): Promise<Result<void, FsError>>;
  realPath(path: string): Promise<Result<string, FsError>>;
  copyFile(src: string, dest: string): Promise<Result<void, FsError>>;
  glob(
    patterns: string[],
    options: { cwd: string; dot?: boolean }
  ): Result<AsyncIterable<string>, FsError>;
  enumerate(
    path: string,
    options?: { exclude?: FileExclusionPredicate; includeSymlinkFiles?: boolean }
  ): Result<AsyncIterable<string>, FsError>;
}

export function fsErrorMessage(error: FsError): string {
  switch (error.type) {
    case 'invalid-path':
    case 'io':
      return error.message;
    case 'etag-mismatch':
      return `File changed since it was read: ${error.path}`;
    default:
      return `${error.type}: ${error.path}`;
  }
}

export function isFileNotFoundError(error: FsError): boolean {
  return error.type === 'not-found' || error.type === 'not-a-directory';
}
