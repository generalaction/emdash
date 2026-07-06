import path from 'node:path';
import { type FileError, type IFileSystem } from '@emdash/core/files';
import { err, ok, type Result } from '@emdash/shared';
import {
  basenameMachinePath,
  containsMachinePath,
  dirnameMachinePath,
  isAbsoluteMachinePath,
  joinMachinePath,
} from '../path-utils';
import { isRealPathContained as isRealPathContainedByRealPath } from '../realpath-containment';

export type WorkspacePathResolution = {
  path: string;
};

const machinePathOperations = {
  basename: basenameMachinePath,
  contains: containsMachinePath,
  dirname: dirnameMachinePath,
  join: joinMachinePath,
};

export function resolveWorkspacePath(
  workspacePath: string,
  filePath: string,
  options: { allowEmpty?: boolean } = {}
): Result<WorkspacePathResolution, FileError> {
  let absPath: string;
  if (isAbsoluteMachinePath(filePath)) {
    absPath = filePath;
  } else {
    const relativePath = normalizeRelativePath(filePath, options);
    if (!relativePath.success) return relativePath;
    absPath = joinMachinePath(workspacePath, relativePath.data);
  }

  if (!containsMachinePath(workspacePath, absPath)) {
    return err({
      type: 'invalid-path',
      path: filePath,
      message: 'Path must be inside the workspace',
    });
  }

  return ok({ path: absPath });
}

export async function assertWorkspaceWriteAllowed(
  fileSystem: IFileSystem,
  workspacePath: string,
  filePath: string
): Promise<Result<WorkspacePathResolution, FileError>> {
  const resolved = resolveWorkspacePath(workspacePath, filePath);
  if (!resolved.success) return resolved;
  const contained = await isWorkspaceRealPathContained(
    fileSystem,
    workspacePath,
    resolved.data.path
  );
  if (!contained.success) return contained;
  if (!contained.data) return pathEscapeError(filePath);
  return resolved;
}

export async function assertWorkspaceRemoveAllowed(
  fileSystem: IFileSystem,
  workspacePath: string,
  filePath: string
): Promise<Result<WorkspacePathResolution, FileError>> {
  const resolved = resolveWorkspacePath(workspacePath, filePath);
  if (!resolved.success) return resolved;
  const parentPath = dirnameMachinePath(resolved.data.path);
  const contained = await isWorkspaceRealPathContained(fileSystem, workspacePath, parentPath);
  if (!contained.success) return contained;
  if (!contained.data) return pathEscapeError(filePath);
  return resolved;
}

export async function assertWorkspaceDirectoryTargetAllowed(
  fileSystem: IFileSystem,
  workspacePath: string,
  dirPath: string
): Promise<Result<WorkspacePathResolution, FileError>> {
  const resolved = resolveWorkspacePath(workspacePath, dirPath, { allowEmpty: true });
  if (!resolved.success) return resolved;
  const contained = await isWorkspaceRealPathContained(
    fileSystem,
    workspacePath,
    resolved.data.path
  );
  if (!contained.success) return contained;
  if (!contained.data) return pathEscapeError(dirPath);
  return resolved;
}

async function isWorkspaceRealPathContained(
  fileSystem: IFileSystem,
  workspacePath: string,
  candidatePath: string
): Promise<Result<boolean, FileError>> {
  return isRealPathContainedByRealPath(
    fileSystem,
    machinePathOperations,
    workspacePath,
    candidatePath,
    {
      candidateErrorMode: 'error',
    }
  );
}

function normalizeRelativePath(
  filePath: string,
  options: { allowEmpty?: boolean }
): Result<string, FileError> {
  if (filePath.includes('\0')) return invalidPathError(filePath, 'Path contains a null byte');
  const normalized = path.posix.normalize(filePath.replace(/\\/g, '/'));
  if (normalized === '.') {
    if (options.allowEmpty) return ok('');
    return invalidPathError(filePath, 'Path must not be empty');
  }
  if (path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) {
    return invalidPathError(filePath, 'Path must be relative');
  }
  const parts = normalized.split('/').filter(Boolean);
  if (parts.includes('..'))
    return invalidPathError(filePath, 'Parent path segments are not allowed');
  return ok(parts.join('/'));
}

function pathEscapeError(inputPath: string): Result<never, FileError> {
  return invalidPathError(inputPath, 'Path resolves outside the workspace');
}

function invalidPathError(inputPath: string, message: string): Result<never, FileError> {
  return err({
    type: 'invalid-path',
    path: inputPath,
    message,
  });
}
