import type { Result } from '@emdash/shared';
import type { FileError } from '../errors';

export type FileStat = {
  path: string;
  type: 'file' | 'directory';
  size: number;
  mtime: Date;
  ctime: Date;
  mode: number;
};

export type ReadFileOptions = {
  maxBytes?: number;
};

export type ReadTextResult = {
  content: string;
  truncated: boolean;
  totalSize: number;
};

export type ReadBytesResult = {
  bytes: Uint8Array;
  truncated: boolean;
  totalSize: number;
};

export type WriteFileResult = {
  bytesWritten: number;
};

export interface IFileSystem {
  readText(path: string, options?: ReadFileOptions): Promise<Result<ReadTextResult, FileError>>;
  readBytes(path: string, options?: ReadFileOptions): Promise<Result<ReadBytesResult, FileError>>;
  writeText(path: string, content: string): Promise<Result<WriteFileResult, FileError>>;
  writeBytes(path: string, bytes: Uint8Array): Promise<Result<WriteFileResult, FileError>>;
  stat(path: string): Promise<Result<FileStat, FileError>>;
  exists(path: string): Promise<Result<boolean, FileError>>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<Result<void, FileError>>;
  remove(path: string, options?: { recursive?: boolean }): Promise<Result<void, FileError>>;
  realPath(path: string): Promise<Result<string, FileError>>;
  copyFile(src: string, dest: string): Promise<Result<void, FileError>>;
}
