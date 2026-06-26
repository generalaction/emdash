import {
  isFileNotFoundError,
  type FileError,
  type FileStat,
  type IFileSystem,
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
  const fs = opened.data;

  let current = absPath;
  const tail: string[] = [];
  for (;;) {
    const real = await fs.realPath(current);
    if (real.success) {
      const resolved = tail.length
        ? files.path.join(real.data, ...tail.slice().reverse())
        : real.data;
      return ok(resolved);
    }
    if (!isFileNotFoundError(real.error)) return real;

    const parent = files.path.dirname(current);
    if (parent === current) {
      return err({
        type: 'invalid-path',
        path: absPath,
        message: `No existing ancestor for path: ${absPath}`,
      });
    }
    tail.push(files.path.basename(current));
    current = parent;
  }
}

export async function isRealPathContained(
  files: IFilesRuntime,
  rootPath: string,
  candidatePath: string,
  options: { candidateMustExist?: boolean } = {}
): Promise<Result<boolean, FileError>> {
  const rootReal = await realPathAbsolute(files, rootPath);
  if (!rootReal.success) return rootReal;

  const candidateReal = options.candidateMustExist
    ? await realPathAbsolute(files, candidatePath)
    : await realPathNearestExisting(files, candidatePath);
  if (!candidateReal.success) return ok(false);

  return ok(
    candidateReal.data === rootReal.data || files.path.contains(rootReal.data, candidateReal.data)
  );
}
