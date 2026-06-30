import { type FileError, type FileStat, type IFileSystem } from '@emdash/core/files';
import { err, type Result } from '@emdash/shared';
import {
  isRealPathContained as isRealPathContainedByRealPath,
  realPathNearestExisting as realPathNearestExistingByRealPath,
} from '../files/realpath-containment';
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

export async function realPathNearestExisting(
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
  return realPathNearestExistingByRealPath(opened.data, files.path, absPath);
}

export async function isRealPathContained(
  files: IFilesRuntime,
  rootPath: string,
  candidatePath: string,
  options: { candidateMustExist?: boolean } = {}
): Promise<Result<boolean, FileError>> {
  if (!files.path.isAbsolute(rootPath)) {
    return err({
      type: 'invalid-path',
      path: rootPath,
      message: `Expected absolute path: ${rootPath}`,
    });
  }
  if (!files.path.isAbsolute(candidatePath)) {
    return err({
      type: 'invalid-path',
      path: candidatePath,
      message: `Expected absolute path: ${candidatePath}`,
    });
  }

  const opened = openFileSystem(files);
  if (!opened.success) return opened;
  return isRealPathContainedByRealPath(opened.data, files.path, rootPath, candidatePath, options);
}
