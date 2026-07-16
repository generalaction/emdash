import { extname } from 'node:path';
import type {
  MobileAccessError,
  MobileDiffEntry,
  MobileDiffRead,
  MobileFileEntry,
  MobileFileRead,
} from '@emdash/core/mobile-access';
import { ok, type Result } from '@emdash/shared';
import {
  ALLOWED_IMAGE_EXTENSIONS,
  readWorkspaceImage,
} from '@main/core/files/file-system/image-support';
import { resolveWorkspacePath } from '@main/core/files/file-system/workspace-file-policy';
import {
  basenameMachinePath,
  containsMachinePath,
  displayPathInDirectory,
} from '@main/core/files/path-utils';
import type { Workspace } from '@main/core/workspaces/workspace';
import { mobileError, toMobileError } from './errors';
import { getReadyTaskContext } from './task-context';

const MAX_TEXT_BYTES = 200 * 1024;
const MAX_DIFF_BYTES = 512 * 1024;

export async function listMobileFiles(
  taskId: string,
  relativeDirectory: string
): Promise<Result<MobileFileEntry[], MobileAccessError>> {
  try {
    const { workspace } = await getReadyTaskContext(taskId);
    const directory = await safeWorkspacePath(workspace, relativeDirectory, true);
    const matched = workspace.fileSystem.glob(['*'], { cwd: directory, dot: true });
    if (!matched.success) return mobileError('runtime_error', matched.error.message);

    const entries: MobileFileEntry[] = [];
    for await (const absolutePath of matched.data) {
      const real = await workspace.fileSystem.realPath(absolutePath);
      if (!real.success || !containsMachinePath(workspace.path, real.data)) continue;
      const stat = await workspace.fileSystem.stat(absolutePath);
      if (!stat.success) continue;
      entries.push({
        name: basenameMachinePath(absolutePath),
        path: displayPathInDirectory(workspace.path, absolutePath),
        kind: stat.data.type,
      });
      if (entries.length >= 500) break;
    }
    entries.sort((left, right) => {
      if (left.kind === 'directory' && right.kind !== 'directory') return -1;
      if (left.kind !== 'directory' && right.kind === 'directory') return 1;
      return left.name.localeCompare(right.name);
    });
    return ok(entries);
  } catch (error) {
    return { success: false, error: toMobileError(error) };
  }
}

export async function readMobileFile(
  taskId: string,
  relativePath: string
): Promise<Result<MobileFileRead, MobileAccessError>> {
  try {
    const { workspace } = await getReadyTaskContext(taskId);
    const absolutePath = await safeWorkspacePath(workspace, relativePath, false);
    const extension = extname(relativePath).toLowerCase();
    if (ALLOWED_IMAGE_EXTENSIONS.has(extension)) {
      const read = await readWorkspaceImage(workspace.fileSystem, absolutePath);
      if (!read.success) return mobileError('runtime_error', 'Image could not be read');
      if (!read.data.success) {
        const message = read.data.error;
        return mobileError(/too large/i.test(message) ? 'too_large' : 'runtime_error', message);
      }
      return ok({
        path: relativePath,
        kind: 'image',
        mimeType: read.data.mimeType,
        content: read.data.dataUrl,
        truncated: false,
        totalSize: read.data.size,
      });
    }

    const bytes = await workspace.fileSystem.readBytes(absolutePath, { maxBytes: MAX_TEXT_BYTES });
    if (!bytes.success) return mobileError('runtime_error', bytes.error.message);
    if (looksBinary(bytes.data.bytes)) {
      return ok({
        path: relativePath,
        kind: 'binary',
        content: null,
        truncated: bytes.data.truncated,
        totalSize: bytes.data.totalSize,
      });
    }
    return ok({
      path: relativePath,
      kind: 'text',
      content: new TextDecoder().decode(bytes.data.bytes),
      truncated: bytes.data.truncated,
      totalSize: bytes.data.totalSize,
    });
  } catch (error) {
    return { success: false, error: toMobileError(error) };
  }
}

export async function listMobileDiffs(
  taskId: string
): Promise<Result<MobileDiffEntry[], MobileAccessError>> {
  try {
    const { workspace } = await getReadyTaskContext(taskId);
    const status = await workspace.gitWorktree.getStatus();
    if (status.kind === 'error') return mobileError('runtime_error', status.message);
    if (status.kind === 'too-many-files') {
      return mobileError('too_large', 'There are too many changed files to display');
    }
    return ok([
      ...status.staged.map((change) => ({
        path: change.path,
        status: change.status,
        staged: true,
        additions: change.additions,
        deletions: change.deletions,
      })),
      ...status.unstaged.map((change) => ({
        path: change.path,
        status: change.status,
        staged: false,
        additions: change.additions,
        deletions: change.deletions,
      })),
    ]);
  } catch (error) {
    return { success: false, error: toMobileError(error) };
  }
}

export async function readMobileDiff(
  taskId: string,
  relativePath: string,
  staged: boolean
): Promise<Result<MobileDiffRead, MobileAccessError>> {
  try {
    const { workspace } = await getReadyTaskContext(taskId);
    await safeWorkspacePath(workspace, relativePath, false, true);
    const original = staged
      ? await workspace.gitWorktree.getFileAtRef(relativePath, 'HEAD')
      : ((await workspace.gitWorktree.getFileAtIndex(relativePath)) ??
        (await workspace.gitWorktree.getFileAtRef(relativePath, 'HEAD')));
    const modified = staged
      ? await workspace.gitWorktree.getFileAtIndex(relativePath)
      : await readDiskText(workspace, relativePath);

    if (containsBinaryMarker(original) || containsBinaryMarker(modified)) {
      return ok({ path: relativePath, patch: null, binary: true, truncated: false });
    }

    const patch = buildUnifiedPatch(relativePath, original ?? '', modified ?? '');
    const encoded = new TextEncoder().encode(patch);
    const truncated = encoded.byteLength > MAX_DIFF_BYTES;
    const content = truncated
      ? new TextDecoder().decode(encoded.subarray(0, MAX_DIFF_BYTES))
      : patch;
    return ok({ path: relativePath, patch: content, binary: false, truncated });
  } catch (error) {
    return { success: false, error: toMobileError(error) };
  }
}

async function safeWorkspacePath(
  workspace: Workspace,
  relativePath: string,
  allowEmpty: boolean,
  allowMissing = false
): Promise<string> {
  const resolved = resolveWorkspacePath(workspace.path, relativePath, { allowEmpty });
  if (!resolved.success) throw new Error(resolved.error.message);
  const [realRoot, realTarget] = await Promise.all([
    workspace.fileSystem.realPath(workspace.path),
    workspace.fileSystem.realPath(resolved.data.path),
  ]);
  if (!realRoot.success) throw new Error(realRoot.error.message);
  if (!realTarget.success) {
    if (allowMissing) return resolved.data.path;
    throw new Error(realTarget.error.message);
  }
  if (!containsMachinePath(realRoot.data, realTarget.data)) {
    throw new Error('Path resolves outside the workspace');
  }
  return resolved.data.path;
}

async function readDiskText(workspace: Workspace, relativePath: string): Promise<string | null> {
  const resolved = resolveWorkspacePath(workspace.path, relativePath);
  if (!resolved.success) throw new Error(resolved.error.message);
  const read = await workspace.fileSystem.readText(resolved.data.path, {
    maxBytes: MAX_DIFF_BYTES,
  });
  if (!read.success) return null;
  return read.data.content;
}

function looksBinary(bytes: Uint8Array): boolean {
  const length = Math.min(bytes.byteLength, 8 * 1024);
  for (let index = 0; index < length; index += 1) {
    if (bytes[index] === 0) return true;
  }
  return false;
}

function containsBinaryMarker(value: string | null): boolean {
  return value?.includes('\0') ?? false;
}

function buildUnifiedPatch(path: string, before: string, after: string): string {
  if (before === after) return `--- a/${path}\n+++ b/${path}\n`;
  const left = before.split('\n');
  const right = after.split('\n');
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix])
    prefix += 1;
  let suffix = 0;
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - suffix - 1] === right[right.length - suffix - 1]
  ) {
    suffix += 1;
  }
  const contextStart = Math.max(0, prefix - 3);
  const leftEnd = Math.min(left.length, left.length - suffix + 3);
  const rightEnd = Math.min(right.length, right.length - suffix + 3);
  const lines = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${contextStart + 1},${leftEnd - contextStart} +${contextStart + 1},${rightEnd - contextStart} @@`,
  ];
  for (let index = contextStart; index < prefix; index += 1) lines.push(` ${left[index] ?? ''}`);
  for (let index = prefix; index < left.length - suffix; index += 1)
    lines.push(`-${left[index] ?? ''}`);
  for (let index = prefix; index < right.length - suffix; index += 1)
    lines.push(`+${right[index] ?? ''}`);
  for (let index = Math.max(prefix, right.length - suffix); index < rightEnd; index += 1) {
    lines.push(` ${right[index] ?? ''}`);
  }
  return `${lines.join('\n')}\n`;
}
