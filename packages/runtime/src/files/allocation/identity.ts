import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ContentKey, FsError, TreeKey } from '@emdash/core/files';
import { err, ok, type Result } from '@emdash/shared';
import { toFsError } from '../api/errors';

export type RootIdentity = {
  rootId: string;
  rootPath: string;
};

export type TreeIdentity = {
  treeId: string;
  root: RootIdentity;
  sessionId: string;
};

export type ContentIdentity = {
  contentId: string;
  root: RootIdentity;
  path: string;
};

export async function resolveRootIdentity(
  rootPath: string
): Promise<Result<RootIdentity, FsError>> {
  if (rootPath.includes('\0') || !path.isAbsolute(rootPath)) {
    return err({
      type: 'invalid-path',
      path: '',
      message: 'Workspace root must be an absolute path without NUL bytes',
    });
  }
  try {
    const canonical = await realpath(rootPath);
    const metadata = await stat(canonical);
    if (!metadata.isDirectory()) return err({ type: 'not-a-directory', path: '' });
    return ok({ rootId: canonical, rootPath: canonical });
  } catch (error) {
    return err(toFsError(error, ''));
  }
}

export function treeIdentity(root: RootIdentity, key: TreeKey): TreeIdentity {
  return {
    treeId: JSON.stringify([root.rootId, key.sessionId]),
    root,
    sessionId: key.sessionId,
  };
}

export function contentIdentity(root: RootIdentity, key: ContentKey): ContentIdentity {
  return {
    contentId: JSON.stringify([root.rootId, key.path]),
    root,
    path: key.path,
  };
}
