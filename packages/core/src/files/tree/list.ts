import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import { isIgnoredInsideRoot } from '../ignores';
import { contains, validateAbsolutePath } from '../paths';
import { classifyFileTreeFsError, type FileTreeError } from './errors';
import type { CompactChainSegment, FileNodeType } from './models/tree';

export type DevIno = `${number}:${number}`;

export type ListedEntry = {
  path: string;
  name: string;
  type: FileNodeType;
  devIno?: DevIno;
};

export type DirectoryProbe = {
  childCount: number;
  compactChain: CompactChainSegment[];
};

const MAX_COMPACT_CHAIN_DEPTH = 64;

type LightEntry = { path: string; name: string; type: FileNodeType };

export async function listChildren(
  rootPath: string,
  dirPath: string
): Promise<Result<ListedEntry[], FileTreeError>> {
  const resolvedRoot = validateAbsolutePath(rootPath);
  if (!resolvedRoot.success) return resolvedRoot;
  const resolvedDir = resolveTreePath(resolvedRoot.data, dirPath);
  if (!resolvedDir.success) return resolvedDir;

  let entries;
  try {
    entries = await readdir(resolvedDir.data, { withFileTypes: true });
  } catch (error) {
    return err(classifyFileTreeFsError(error, resolvedDir.data));
  }

  const candidates: Array<Omit<ListedEntry, 'devIno'>> = [];
  for (const entry of entries) {
    if (!entry.isFile() && !entry.isDirectory()) continue;
    const absPath = path.join(resolvedDir.data, entry.name);
    if (isIgnoredInsideRoot(resolvedRoot.data, absPath)) continue;
    candidates.push({
      path: absPath,
      name: path.basename(absPath),
      type: entry.isDirectory() ? 'directory' : 'file',
    });
  }

  const devInos = await Promise.all(candidates.map((entry) => statDevIno(entry.path)));
  const listed: ListedEntry[] = candidates.map((entry, index) => ({
    ...entry,
    devIno: devInos[index],
  }));

  listed.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return ok(listed);
}

export async function probeDirectory(rootPath: string, dirPath: string): Promise<DirectoryProbe> {
  const children = await listChildNames(rootPath, dirPath);
  if (!children) return { childCount: 0, compactChain: [] };

  const childCount = children.length;
  const compactChain: CompactChainSegment[] = [];
  const visited = new Set<string>([dirPath]);
  let current = children;
  while (
    current.length === 1 &&
    current[0].type === 'directory' &&
    !visited.has(current[0].path) &&
    compactChain.length < MAX_COMPACT_CHAIN_DEPTH
  ) {
    const only = current[0];
    compactChain.push({ name: only.name, path: only.path });
    visited.add(only.path);
    const next = await listChildNames(rootPath, only.path);
    if (!next) break;
    current = next;
  }
  return { childCount, compactChain };
}

async function listChildNames(rootPath: string, dirPath: string): Promise<LightEntry[] | null> {
  const resolvedRoot = validateAbsolutePath(rootPath);
  if (!resolvedRoot.success) return null;
  const resolvedDir = resolveTreePath(resolvedRoot.data, dirPath);
  if (!resolvedDir.success) return null;

  let entries;
  try {
    entries = await readdir(resolvedDir.data, { withFileTypes: true });
  } catch {
    return null;
  }

  const result: LightEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile() && !entry.isDirectory()) continue;
    const absPath = path.join(resolvedDir.data, entry.name);
    if (isIgnoredInsideRoot(resolvedRoot.data, absPath)) continue;
    result.push({
      path: absPath,
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
    });
  }
  return result;
}

export async function statEntry(
  rootPath: string,
  absPath: string
): Promise<Result<ListedEntry, FileTreeError>> {
  const resolvedRoot = validateAbsolutePath(rootPath);
  if (!resolvedRoot.success) return resolvedRoot;
  const resolvedPath = resolveTreePath(resolvedRoot.data, absPath);
  if (!resolvedPath.success) return resolvedPath;

  try {
    const stats = await lstat(resolvedPath.data);
    if (!stats.isFile() && !stats.isDirectory()) {
      return err({ type: 'not-found', path: resolvedPath.data });
    }
    return ok({
      path: resolvedPath.data,
      name: path.basename(resolvedPath.data),
      type: stats.isDirectory() ? 'directory' : 'file',
      devIno: toDevIno(stats.dev, stats.ino),
    });
  } catch (error) {
    return err(classifyFileTreeFsError(error, resolvedPath.data));
  }
}

function resolveTreePath(rootPath: string, inputPath: string): Result<string, FileTreeError> {
  const absPath = inputPath ? inputPath : rootPath;
  const validated = validateAbsolutePath(absPath);
  if (!validated.success) return validated;
  if (!contains(rootPath, validated.data)) {
    return err({ type: 'invalid-path', path: inputPath, message: 'Path is outside tree root' });
  }
  return ok(validated.data);
}

async function statDevIno(absPath: string): Promise<DevIno | undefined> {
  try {
    const stats = await lstat(absPath);
    return toDevIno(stats.dev, stats.ino);
  } catch {
    return undefined;
  }
}

function toDevIno(dev: number, ino: number): DevIno | undefined {
  if (!Number.isFinite(dev) || !Number.isFinite(ino) || ino === 0) return undefined;
  return `${dev}:${ino}`;
}
