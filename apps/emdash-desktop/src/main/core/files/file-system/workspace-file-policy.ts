import {
  createPathProfile,
  createPathSemantics,
  joinAbsolute,
  parsePortableRelativePath,
  type PortableRelativePath,
} from '@emdash/core/primitives/path/api';
import type { FsError } from '@emdash/core/runtimes/files/api';
import { err, ok, type Result } from '@emdash/shared';
import { hostPathFromNative, nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import type { FilesClientScope } from '@core/services/runtime-broker/node/files';
import { isRealPathContained as isRealPathContainedByRealPath } from '../realpath-containment';

export type WorkspacePathResolution = {
  path: string;
};

export function resolveWorkspacePath(
  workspacePath: string,
  filePath: string,
  options: { allowEmpty?: boolean } = {}
): Result<WorkspacePathResolution, FsError> {
  let root;
  try {
    root = hostPathFromNative(workspacePath);
  } catch (error) {
    return invalidPathError(workspacePath, error instanceof Error ? error.message : String(error));
  }

  let candidate;
  try {
    candidate = hostPathFromNative(filePath);
  } catch {
    const relativePath = normalizeRelativePath(filePath, options);
    if (!relativePath.success) return relativePath;
    const joined = joinAbsolute(root, relativePath.data);
    if (!joined.success) return invalidPathError(filePath, joined.error.message);
    candidate = joined.data;
  }

  const profile = createPathProfile({ style: root.root.kind === 'posix' ? 'posix' : 'win32' });
  if (!createPathSemantics(profile).contains(root, candidate)) {
    return invalidPathError(filePath, 'Path must be inside the workspace');
  }

  return ok({
    path: nativePathFromHost({
      root: root.root,
      segments: [...root.segments, ...candidate.segments.slice(root.segments.length)],
    }),
  });
}

export async function assertWorkspaceWriteAllowed(
  files: FilesClientScope,
  workspacePath: string,
  filePath: string
): Promise<Result<WorkspacePathResolution, FsError>> {
  const resolved = resolveWorkspacePath(workspacePath, filePath);
  if (!resolved.success) return resolved;
  const contained = await isWorkspaceRealPathContained(files, workspacePath, resolved.data.path);
  if (!contained.success) return contained;
  if (!contained.data) return pathEscapeError(filePath);
  return resolved;
}

export async function assertWorkspaceDirectoryTargetAllowed(
  files: FilesClientScope,
  workspacePath: string,
  dirPath: string
): Promise<Result<WorkspacePathResolution, FsError>> {
  const resolved = resolveWorkspacePath(workspacePath, dirPath, { allowEmpty: true });
  if (!resolved.success) return resolved;
  const contained = await isWorkspaceRealPathContained(files, workspacePath, resolved.data.path);
  if (!contained.success) return contained;
  if (!contained.data) return pathEscapeError(dirPath);
  return resolved;
}

async function isWorkspaceRealPathContained(
  files: FilesClientScope,
  workspacePath: string,
  candidatePath: string
): Promise<Result<boolean, FsError>> {
  return isRealPathContainedByRealPath(
    files,
    hostPathFromNative(workspacePath),
    hostPathFromNative(candidatePath),
    { candidateErrorMode: 'error' }
  );
}

function normalizeRelativePath(
  filePath: string,
  options: { allowEmpty?: boolean }
): Result<PortableRelativePath, FsError> {
  const parsed = parsePortableRelativePath(filePath.replaceAll('\\', '/'), {
    unicodeNormalization: 'preserve',
  });
  if (!parsed.success) return invalidPathError(filePath, parsed.error.message);
  if (parsed.data === '' && !options.allowEmpty) {
    return invalidPathError(filePath, 'Path must not be empty');
  }
  return ok(parsed.data);
}

function pathEscapeError(inputPath: string): Result<never, FsError> {
  return invalidPathError(inputPath, 'Path resolves outside the workspace');
}

function invalidPathError(inputPath: string, message: string): Result<never, FsError> {
  return err({
    type: 'invalid-path',
    path: inputPath,
    message,
  });
}
