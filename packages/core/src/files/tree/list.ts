import { type Result } from '@emdash/shared';
import { createRootPathPolicy } from '../path-policy';
import {
  createTreeDirectoryReader,
  type DevIno,
  type DirectoryEntry,
  type TreeDirectoryReader,
} from './directory-reader';
import type { FileTreeError } from './errors';
import type { DirectoryPreviewSegment } from './models/tree';

export type { DevIno, DirectoryEntry as ListedEntry };

export type DirectoryProbe = {
  childCount: number;
  singleChildDirectoryChain: DirectoryPreviewSegment[];
};

const MAX_COMPACT_CHAIN_DEPTH = 64;

export async function listChildren(
  rootPath: string,
  dirPath: string
): Promise<Result<DirectoryEntry[], FileTreeError>> {
  const reader = readerForRoot(rootPath);
  if (!reader.success) return reader;
  const read = await reader.data.readChildren(dirPath, { includeDevIno: true, sort: true });
  if (!read.success) return read;
  return read.data.kind === 'entries'
    ? { success: true, data: read.data.entries }
    : { success: true, data: [] };
}

export async function probeDirectory(rootPath: string, dirPath: string): Promise<DirectoryProbe> {
  const reader = readerForRoot(rootPath);
  if (!reader.success) return { childCount: 0, singleChildDirectoryChain: [] };
  return probeDirectoryWithReader(reader.data, dirPath);
}

export async function probeDirectoryWithReader(
  reader: TreeDirectoryReader,
  dirPath: string
): Promise<DirectoryProbe> {
  const children = await readProbeChildren(reader, dirPath);
  if (!children) return { childCount: 0, singleChildDirectoryChain: [] };

  const childCount = children.length;
  const singleChildDirectoryChain: DirectoryPreviewSegment[] = [];
  const visited = new Set<string>([dirPath]);
  let current = children;
  while (
    current.length === 1 &&
    current[0].type === 'directory' &&
    !visited.has(current[0].path) &&
    singleChildDirectoryChain.length < MAX_COMPACT_CHAIN_DEPTH
  ) {
    const only = current[0];
    singleChildDirectoryChain.push({ name: only.name, path: only.path });
    visited.add(only.path);
    const next = await readProbeChildren(reader, only.path);
    if (!next) break;
    current = next;
  }
  return { childCount, singleChildDirectoryChain };
}

export async function statEntry(
  rootPath: string,
  absPath: string
): Promise<Result<DirectoryEntry, FileTreeError>> {
  const reader = readerForRoot(rootPath);
  if (!reader.success) return reader;
  return reader.data.statEntry(absPath);
}

function readerForRoot(rootPath: string): Result<TreeDirectoryReader, FileTreeError> {
  const policy = createRootPathPolicy(rootPath);
  if (!policy.success) return policy;
  return { success: true, data: createTreeDirectoryReader(policy.data) };
}

async function readProbeChildren(
  reader: TreeDirectoryReader,
  dirPath: string
): Promise<DirectoryEntry[] | null> {
  const read = await reader.readChildren(dirPath, { softFail: true });
  if (!read.success || read.data.kind === 'unreadable') return null;
  return read.data.entries;
}
