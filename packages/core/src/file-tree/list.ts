import { readdir, stat } from 'node:fs/promises';
import { err, ok, type Result } from '@emdash/shared';
import { classifyFileTreeFsError, type FileTreeError } from './errors';
import { isExcludedPath } from './ignores';
import type { FileNodeType } from './models/tree';
import { basenameFromRelPath, resolveInsideRoot } from './paths';

export type DevIno = `${number}:${number}`;

export type ListedEntry = {
  path: string;
  name: string;
  type: FileNodeType;
  devIno?: DevIno;
};

export async function listChildren(
  rootPath: string,
  dirPath: string
): Promise<Result<ListedEntry[], FileTreeError>> {
  const resolved = resolveInsideRoot(rootPath, dirPath, { allowEmpty: true });
  if (!resolved.success) return resolved;

  let entries;
  try {
    entries = await readdir(resolved.data.absPath, { withFileTypes: true });
  } catch (error) {
    return err(classifyFileTreeFsError(error, resolved.data.relPath));
  }

  const candidates: Array<Omit<ListedEntry, 'devIno'> & { absPath: string }> = [];
  for (const entry of entries) {
    if (!entry.isFile() && !entry.isDirectory()) continue;
    const relPath = resolved.data.relPath ? `${resolved.data.relPath}/${entry.name}` : entry.name;
    if (isExcludedPath(relPath)) continue;
    const childResolved = resolveInsideRoot(rootPath, relPath);
    if (!childResolved.success) return childResolved;
    candidates.push({
      path: relPath,
      name: basenameFromRelPath(relPath),
      type: entry.isDirectory() ? 'directory' : 'file',
      absPath: childResolved.data.absPath,
    });
  }

  const devInos = await Promise.all(candidates.map((entry) => statDevIno(entry.absPath)));
  const listed: ListedEntry[] = candidates.map((entry, index) => ({
    path: entry.path,
    name: entry.name,
    type: entry.type,
    devIno: devInos[index],
  }));

  listed.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return ok(listed);
}

export async function statEntry(
  rootPath: string,
  relPath: string
): Promise<Result<ListedEntry, FileTreeError>> {
  const resolved = resolveInsideRoot(rootPath, relPath);
  if (!resolved.success) return resolved;
  try {
    const stats = await stat(resolved.data.absPath);
    if (!stats.isFile() && !stats.isDirectory()) {
      return err({ type: 'not-found', path: relPath });
    }
    return ok({
      path: resolved.data.relPath,
      name: basenameFromRelPath(resolved.data.relPath),
      type: stats.isDirectory() ? 'directory' : 'file',
      devIno: toDevIno(stats.dev, stats.ino),
    });
  } catch (error) {
    return err(classifyFileTreeFsError(error, relPath));
  }
}

async function statDevIno(absPath: string): Promise<DevIno | undefined> {
  try {
    const stats = await stat(absPath);
    return toDevIno(stats.dev, stats.ino);
  } catch {
    return undefined;
  }
}

function toDevIno(dev: number, ino: number): DevIno | undefined {
  if (!Number.isFinite(dev) || !Number.isFinite(ino) || ino === 0) return undefined;
  return `${dev}:${ino}`;
}
