import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ContentKey, FsError, TreeKey } from '@emdash/core/files';
import {
  comparisonKeyForAbsolutePath,
  createPathProfile,
  formatAbsolute,
  parseAbsolute,
  type HostAbsolutePath,
  type PortableRelativePath,
} from '@emdash/core/path';
import { err, ok, type Result } from '@emdash/shared';
import { toFsError } from '../api/errors';

export type RootIdentity = {
  rootId: string;
  root: HostAbsolutePath;
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
  path: PortableRelativePath;
};

export async function resolveRootIdentity(
  root: HostAbsolutePath
): Promise<Result<RootIdentity, FsError>> {
  const compatible = path.sep === '\\' ? root.root.kind !== 'posix' : root.root.kind === 'posix';
  if (!compatible) {
    return err({
      type: 'invalid-path',
      path: '',
      message: `Path style is not valid on this host: ${formatAbsolute(root)}`,
    });
  }
  const rootPath = formatAbsolute(root, { separator: path.sep as '/' | '\\' });
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
    const parsed = parseAbsolute(canonical, {
      profile: {
        style: path.sep === '\\' ? 'win32' : 'posix',
        unicodeNormalization: 'preserve',
      },
    });
    if (!parsed.success) {
      return err({ type: 'invalid-path', path: '', message: parsed.error.message });
    }
    const profile = createPathProfile({ style: path.sep === '\\' ? 'win32' : 'posix' });
    return ok({
      rootId: comparisonKeyForAbsolutePath(parsed.data, profile),
      root: parsed.data,
      rootPath: canonical,
    });
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
    contentId: JSON.stringify([root.rootId, key.relative]),
    root,
    path: key.relative,
  };
}
