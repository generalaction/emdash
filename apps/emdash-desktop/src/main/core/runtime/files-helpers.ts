import {
  createPathProfile,
  createPathSemantics,
  parseNativeAbsolute,
  type HostAbsolutePath,
} from '@emdash/core/primitives/path/api';
import type { FsError } from '@emdash/core/runtimes/files/api';
import { err, ok, type Result } from '@emdash/shared';
import { nativePathFromHost, resolveRelativePath } from '@core/primitives/desktop-runtime/api';
import {
  fileKey,
  fileRelativePath,
  filesClientScope,
  parentFilePaths,
  type FilesClientScope,
} from '@core/services/runtime-broker/node/files';
import { isRealPathContained as isRealPathContainedByRealPath } from '../files/realpath-containment';

type FilesRuntimeClient = FilesClientScope['client'];
type GetFilesRuntimeClient = () => Promise<FilesRuntimeClient>;

export function createFilesHelpers(getFilesRuntimeClient: GetFilesRuntimeClient) {
  return {
    ensureAbsoluteDir: (rootPath: string, absPath: string, options: { recursive?: boolean } = {}) =>
      ensureAbsoluteDir(getFilesRuntimeClient, rootPath, absPath, options),
    realPathAbsolute: (rootPath: string, absPath: string) =>
      realPathAbsolute(getFilesRuntimeClient, rootPath, absPath),
    isRealPathContained: (
      rootPath: string,
      candidatePath: string,
      options: { candidateMustExist?: boolean } = {}
    ) => isRealPathContained(getFilesRuntimeClient, rootPath, candidatePath, options),
  };
}

async function openFilesClientScope(
  getFilesRuntimeClient: GetFilesRuntimeClient,
  rootPath: string
): Promise<Result<FilesClientScope, FsError>> {
  const root = parseAbsolutePath(rootPath);
  if (!root.success) return root;
  return ok(filesClientScope(await getFilesRuntimeClient(), root.data));
}

export async function ensureAbsoluteDir(
  getFilesRuntimeClient: GetFilesRuntimeClient,
  rootPath: string,
  absPath: string,
  options: { recursive?: boolean } = {}
): Promise<Result<void, FsError>> {
  const root = parseAbsolutePath(rootPath);
  if (!root.success) return root;
  const target = parseAbsolutePath(absPath);
  if (!target.success) return target;
  const profile = createPathProfile({ style: root.data.root.kind === 'posix' ? 'posix' : 'win32' });
  if (!createPathSemantics(profile).contains(root.data, target.data)) {
    return err(expectedContainedPath(rootPath, absPath));
  }

  const recursive = options.recursive ?? true;
  const client = await getFilesRuntimeClient();
  const volumeRoot: HostAbsolutePath = { root: root.data.root, segments: [] };
  const rootReady = await ensureDirectory(filesClientScope(client, volumeRoot), root.data, {
    recursive,
  });
  if (!rootReady.success) return rootReady;

  return ensureDirectory(filesClientScope(client, root.data), target.data, { recursive });
}

async function realPathAbsolute(
  getFilesRuntimeClient: GetFilesRuntimeClient,
  rootPath: string,
  absPath: string
): Promise<Result<string, FsError>> {
  const opened = await openFilesClientScope(getFilesRuntimeClient, rootPath);
  if (!opened.success) return opened;
  const target = parseAbsolutePath(absPath);
  if (!target.success) return target;
  const result = await opened.data.client.fs.realPath(fileKey(opened.data, target.data));
  return result.success ? ok(nativePathFromHost(result.data.path)) : result;
}

async function isRealPathContained(
  getFilesRuntimeClient: GetFilesRuntimeClient,
  rootPath: string,
  candidatePath: string,
  options: { candidateMustExist?: boolean } = {}
): Promise<Result<boolean, FsError>> {
  const opened = await openFilesClientScope(getFilesRuntimeClient, rootPath);
  if (!opened.success) return opened;
  const candidate = parseAbsolutePath(candidatePath);
  if (!candidate.success) return candidate;
  return isRealPathContainedByRealPath(opened.data, opened.data.root, candidate.data, options);
}

async function ensureDirectory(
  files: FilesClientScope,
  targetPath: HostAbsolutePath,
  options: { recursive?: boolean }
): Promise<Result<void, FsError>> {
  const relative = fileRelativePath(files, targetPath);
  if (!relative) return ok<void>();
  const candidates = options.recursive ? parentFilePaths(relative) : [relative];
  for (const candidate of candidates) {
    const key = { path: resolveRelativePath(files.root, candidate) };
    const exists = await files.client.fs.exists(key);
    if (!exists.success) return exists;
    if (exists.data.exists) continue;
    const created = await files.client.fs.createDirectory(key);
    if (!created.success && created.error.type !== 'already-exists') return created;
  }
  return ok<void>();
}

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

function parseAbsolutePath(input: string): Result<HostAbsolutePath, FsError> {
  const parsed = parseNativeAbsolute(input);
  return parsed.success ? parsed : err(expectedAbsolutePath(input));
}
