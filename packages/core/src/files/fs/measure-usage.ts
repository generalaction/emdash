import type { Stats } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { FileUsage, FileUsageError } from './types';

type EntryUsage = {
  apparentBytes: number;
  diskBytes: number;
  inodeKey: string | null;
  linkCount: number;
  isDirectory: boolean;
};

type ScanState = {
  entries: EntryUsage[];
  errors: FileUsageError[];
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function diskBytes(stats: Stats): number {
  const blocks = typeof stats.blocks === 'number' ? stats.blocks : 0;
  return blocks > 0 ? blocks * 512 : stats.size;
}

function inodeKey(stats: Stats): string | null {
  if (stats.ino === 0) return null;
  return `${stats.dev}:${stats.ino}`;
}

function aggregateEntries(entries: EntryUsage[]): {
  apparentBytes: number;
  diskBytes: number;
  exclusiveDiskBytes: number;
} {
  let apparentBytes = 0;
  let totalDiskBytes = 0;
  let exclusiveDiskBytes = 0;
  const linked = new Map<string, { count: number; linkCount: number; diskBytes: number }>();

  for (const entry of entries) {
    apparentBytes += entry.apparentBytes;

    if (entry.isDirectory || !entry.inodeKey || entry.linkCount <= 1) {
      totalDiskBytes += entry.diskBytes;
      exclusiveDiskBytes += entry.diskBytes;
      continue;
    }

    const existing = linked.get(entry.inodeKey);
    if (existing) {
      existing.count += 1;
    } else {
      linked.set(entry.inodeKey, {
        count: 1,
        linkCount: entry.linkCount,
        diskBytes: entry.diskBytes,
      });
    }
  }

  for (const group of linked.values()) {
    totalDiskBytes += group.diskBytes;
    if (group.linkCount <= group.count) {
      exclusiveDiskBytes += group.diskBytes;
    }
  }

  return { apparentBytes, diskBytes: totalDiskBytes, exclusiveDiskBytes };
}

async function scanPath(state: ScanState, currentPath: string): Promise<void> {
  let stats: Stats;
  try {
    stats = await lstat(currentPath);
  } catch (error) {
    state.errors.push({ path: currentPath, message: errorMessage(error) });
    return;
  }

  const isDirectory = stats.isDirectory();
  state.entries.push({
    apparentBytes: stats.size,
    diskBytes: diskBytes(stats),
    inodeKey: inodeKey(stats),
    linkCount: stats.nlink,
    isDirectory,
  });

  if (!isDirectory) return;

  let children;
  try {
    children = await readdir(currentPath, { withFileTypes: true });
  } catch (error) {
    state.errors.push({ path: currentPath, message: errorMessage(error) });
    return;
  }

  for (const child of children) {
    await scanPath(state, path.join(currentPath, child.name));
  }
}

/**
 * Unreadable subtrees are recorded as partial errors.
 * @throws the root `lstat` error when `targetPath` itself is inaccessible.
 */
export async function measureUsage(targetPath: string): Promise<FileUsage> {
  const rootStats = await lstat(targetPath);

  if (!rootStats.isDirectory()) {
    return {
      path: targetPath,
      type: 'file',
      apparentBytes: rootStats.size,
      diskBytes: diskBytes(rootStats),
      exclusiveDiskBytes: rootStats.nlink > 1 ? 0 : diskBytes(rootStats),
      errors: [],
    };
  }

  const state: ScanState = { entries: [], errors: [] };
  await scanPath(state, targetPath);

  const total = aggregateEntries(state.entries);
  return {
    path: targetPath,
    type: 'directory',
    apparentBytes: total.apparentBytes,
    diskBytes: total.diskBytes,
    exclusiveDiskBytes: total.exclusiveDiskBytes,
    errors: state.errors,
  };
}
