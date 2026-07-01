import type { DirectoryEntry, TreeDirectoryReader } from './directory-reader';
import type { DirectoryPreviewSegment } from './models/tree';

type DirectoryProbe = {
  childCount: number;
  singleChildDirectoryChain: DirectoryPreviewSegment[];
};

const MAX_COMPACT_CHAIN_DEPTH = 64;

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

async function readProbeChildren(
  reader: TreeDirectoryReader,
  dirPath: string
): Promise<DirectoryEntry[] | null> {
  const read = await reader.readChildren(dirPath, { softFail: true });
  if (!read.success || read.data.kind === 'unreadable') return null;
  return read.data.entries;
}
