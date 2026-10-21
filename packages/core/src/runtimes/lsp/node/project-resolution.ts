import { stat } from 'node:fs/promises';
import path from 'node:path';
import { formatAbsolute, parseNativeAbsolute, type HostAbsolutePath } from '#primitives/path/api';
import type { LspProjectRootQuery } from '../api/schemas';
import { documentUri } from './protocol-values';
import { getServerProfile } from './server-registry';

/** Discover on the file's host, bounded by the task workspace. External files keep that root. */
export async function resolveLanguageProjectRoot(
  input: LspProjectRootQuery
): Promise<HostAbsolutePath> {
  const profile = getServerProfile(input.serverId);
  documentUri(input.workspaceRoot);
  documentUri(input.path);
  const workspace = formatAbsolute(input.workspaceRoot);
  const file = formatAbsolute(input.path);
  const relative = path.relative(workspace, file);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    return input.workspaceRoot;
  let directory = path.dirname(file);
  while (true) {
    for (const marker of profile.rootMarkers) {
      if (await isFile(path.join(directory, marker))) {
        const parsed = parseNativeAbsolute(directory);
        if (!parsed.success) throw new Error('Invalid language project root');
        return parsed.data;
      }
    }
    if (path.relative(workspace, directory) === '' || directory === path.dirname(directory))
      return input.workspaceRoot;
    directory = path.dirname(directory);
  }
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    )
      return false;
    throw error;
  }
}
