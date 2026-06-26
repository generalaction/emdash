import {
  isFileNotFoundError,
  type FileError,
  type FileStat,
  type IFileSystem,
  type ReadFileOptions,
} from '@emdash/core/files';
import { err, ok, type Result } from '@emdash/shared';
import type { IFilesRuntime } from './types';

export type AbsoluteDirectoryFileSystem = {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<Result<void, FileError>>;
  realPath(path: string): Promise<Result<string, FileError>>;
};

export function openFileSystem(files: IFilesRuntime): Result<IFileSystem, FileError> {
  return files.fileSystem();
}

export function absoluteDirectoryFileSystem(files: IFilesRuntime): AbsoluteDirectoryFileSystem {
  return {
    mkdir: (absPath, options) => ensureAbsoluteDir(files, absPath, options),
    realPath: (absPath) => realPathAbsolute(files, absPath),
  };
}

export async function ensureAbsoluteDir(
  files: IFilesRuntime,
  absPath: string,
  options: { recursive?: boolean } = {}
): Promise<Result<void, FileError>> {
  if (!files.path.isAbsolute(absPath)) {
    return err({
      type: 'invalid-path',
      path: absPath,
      message: `Expected absolute path: ${absPath}`,
    });
  }

  const opened = openFileSystem(files);
  if (!opened.success) return opened;
  return opened.data.mkdir(absPath, {
    recursive: options.recursive ?? true,
  });
}

export async function realPathAbsolute(
  files: IFilesRuntime,
  absPath: string
): Promise<Result<string, FileError>> {
  if (!files.path.isAbsolute(absPath)) {
    return err({
      type: 'invalid-path',
      path: absPath,
      message: `Expected absolute path: ${absPath}`,
    });
  }

  const opened = openFileSystem(files);
  if (!opened.success) return opened;
  return opened.data.realPath(absPath);
}

export async function statAbsolute(
  files: IFilesRuntime,
  absPath: string
): Promise<{ success: true; data: FileStat } | { success: false; error: FileError }> {
  if (!files.path.isAbsolute(absPath)) {
    return {
      success: false,
      error: { type: 'invalid-path', path: absPath, message: `Expected absolute path: ${absPath}` },
    };
  }

  const opened = openFileSystem(files);
  if (!opened.success) return opened;
  return opened.data.stat(absPath);
}

export async function readTextIfExists(
  fs: Pick<IFileSystem, 'readText'>,
  absPath: string,
  options?: ReadFileOptions
): Promise<Result<string | null, FileError>> {
  const result = await fs.readText(absPath, options);
  if (result.success) return ok(result.data.content);
  if (isFileNotFoundError(result.error)) return ok(null);
  return result;
}
