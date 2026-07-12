import path from 'node:path';
import type { FsError } from '@emdash/core/files';
import { err, ok, type Result } from '@emdash/shared';
import { RuntimeFileSystem } from '@main/core/files/runtime-files';
import type { FileStat, ScopedFileSystem } from '@main/core/files/scoped-file-system';
import {
  isRealPathContained as isRealPathContainedByRealPath,
  realPathNearestExisting as realPathNearestExistingByRealPath,
} from '../files/realpath-containment';

export type AbsoluteDirectoryFileSystem = {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<Result<void, FsError>>;
  realPath(path: string): Promise<Result<string, FsError>>;
};

export function openFileSystem(rootPath: string): Result<ScopedFileSystem, FsError> {
  if (!path.isAbsolute(rootPath)) return err(expectedAbsolutePath(rootPath));
  return ok(new RuntimeFileSystem(rootPath));
}

export function absoluteDirectoryFileSystem(rootPath: string): AbsoluteDirectoryFileSystem {
  return {
    mkdir: (absPath, options) => ensureAbsoluteDir(rootPath, absPath, options),
    realPath: (absPath) => realPathAbsolute(rootPath, absPath),
  };
}

export async function ensureAbsoluteDir(
  rootPath: string,
  absPath: string,
  options: { recursive?: boolean } = {}
): Promise<Result<void, FsError>> {
  if (!path.isAbsolute(rootPath)) return err(expectedAbsolutePath(rootPath));
  if (!path.isAbsolute(absPath)) return err(expectedAbsolutePath(absPath));
  const resolvedRoot = path.resolve(rootPath);
  const resolvedPath = path.resolve(absPath);
  if (!nativePathOperations.contains(resolvedRoot, resolvedPath)) {
    return err(expectedContainedPath(resolvedRoot, resolvedPath));
  }

  const recursive = options.recursive ?? true;
  const volumeRoot = path.parse(resolvedRoot).root;
  const rootReady = await new RuntimeFileSystem(volumeRoot).mkdir(resolvedRoot, { recursive });
  if (!rootReady.success) return rootReady;

  return new RuntimeFileSystem(resolvedRoot).mkdir(resolvedPath, { recursive });
}

export async function realPathAbsolute(
  rootPath: string,
  absPath: string
): Promise<Result<string, FsError>> {
  const opened = openFileSystem(rootPath);
  if (!opened.success) return opened;
  if (!path.isAbsolute(absPath)) return err(expectedAbsolutePath(absPath));
  return opened.data.realPath(absPath);
}

export async function statAbsolute(
  rootPath: string,
  absPath: string
): Promise<Result<FileStat, FsError>> {
  const opened = openFileSystem(rootPath);
  if (!opened.success) return opened;
  if (!path.isAbsolute(absPath)) return err(expectedAbsolutePath(absPath));
  return opened.data.stat(absPath);
}

export async function realPathNearestExisting(
  rootPath: string,
  absPath: string
): Promise<Result<string, FsError>> {
  const opened = openFileSystem(rootPath);
  if (!opened.success) return opened;
  if (!path.isAbsolute(absPath)) return err(expectedAbsolutePath(absPath));
  return realPathNearestExistingByRealPath(opened.data, nativePathOperations, absPath);
}

export async function isRealPathContained(
  rootPath: string,
  candidatePath: string,
  options: { candidateMustExist?: boolean } = {}
): Promise<Result<boolean, FsError>> {
  const opened = openFileSystem(rootPath);
  if (!opened.success) return opened;
  if (!path.isAbsolute(candidatePath)) return err(expectedAbsolutePath(candidatePath));
  return isRealPathContainedByRealPath(
    opened.data,
    nativePathOperations,
    rootPath,
    candidatePath,
    options
  );
}

const nativePathOperations = {
  basename: path.basename,
  contains(parent: string, child: string): boolean {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  },
  dirname: path.dirname,
  join: path.join,
};

function expectedAbsolutePath(input: string): FsError {
  return { type: 'invalid-path', path: input, message: `Expected absolute path: ${input}` };
}

function expectedContainedPath(rootPath: string, input: string): FsError {
  return {
    type: 'invalid-path',
    path: input,
    message: `Expected path inside ${rootPath}: ${input}`,
  };
}
