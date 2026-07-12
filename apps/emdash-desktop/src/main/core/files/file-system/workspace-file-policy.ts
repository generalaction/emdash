import type { FsError } from '@emdash/core/files';
import {
  absoluteBasename,
  absoluteDirname,
  containsAbsolute,
  joinAbsolute,
  parsePortableRelativePath,
  type PortableRelativePath,
} from '@emdash/core/path';
import { err, ok, type Result } from '@emdash/shared';
import { hostPathFromNative, nativePathFromHost } from '@shared/core/runtime/paths';
import { isRealPathContained as isRealPathContainedByRealPath } from '../realpath-containment';
import type { ScopedFileSystem } from '../scoped-file-system';

export type WorkspacePathResolution = {
  path: string;
};

const machinePathOperations = {
  basename: (input: string) => absoluteBasename(hostPathFromNative(input)),
  contains: (parent: string, child: string) =>
    containsAbsolute(hostPathFromNative(parent), hostPathFromNative(child)),
  dirname: (input: string) => {
    const parsed = hostPathFromNative(input);
    return nativePathFromHost(absoluteDirname(parsed) ?? parsed);
  },
  join: (base: string, ...segments: string[]) => {
    const relative = parsePortableRelativePath(segments.join('/'), {
      unicodeNormalization: 'preserve',
    });
    if (!relative.success) throw new Error(relative.error.message);
    const joined = joinAbsolute(hostPathFromNative(base), relative.data);
    if (!joined.success) throw new Error(joined.error.message);
    return nativePathFromHost(joined.data);
  },
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

  if (!containsAbsolute(root, candidate)) {
    return invalidPathError(filePath, 'Path must be inside the workspace');
  }

  return ok({ path: nativePathFromHost(candidate) });
}

export async function assertWorkspaceWriteAllowed(
  fileSystem: ScopedFileSystem,
  workspacePath: string,
  filePath: string
): Promise<Result<WorkspacePathResolution, FsError>> {
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

export async function assertWorkspaceDirectoryTargetAllowed(
  fileSystem: ScopedFileSystem,
  workspacePath: string,
  dirPath: string
): Promise<Result<WorkspacePathResolution, FsError>> {
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
  fileSystem: ScopedFileSystem,
  workspacePath: string,
  candidatePath: string
): Promise<Result<boolean, FsError>> {
  return isRealPathContainedByRealPath(
    fileSystem,
    machinePathOperations,
    workspacePath,
    candidatePath,
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
