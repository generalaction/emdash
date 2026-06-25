import type { Stats } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { PathStorageUsage } from './types';

type EntryUsage = {
  apparentBytes: number;
  diskBytes: number;
  inodeKey: string | null;
  linkCount: number;
  isDirectory: boolean;
};

type ScanState = {
  entries: EntryUsage[];
  errors: PathStorageUsage['errors'];
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

function createEmptyUsage(
  targetPath: string,
  exists: boolean,
  isDirectory: boolean,
  errors: PathStorageUsage['errors']
): PathStorageUsage {
  return {
    path: targetPath,
    exists,
    isDirectory,
    apparentBytes: 0,
    reclaimableBytes: 0,
    errors,
  };
}

function aggregateEntries(entries: EntryUsage[]): {
  apparentBytes: number;
  reclaimableBytes: number;
} {
  let apparentBytes = 0;
  let reclaimableBytes = 0;
  const linked = new Map<
    string,
    { count: number; linkCount: number; diskBytes: number; apparentBytes: number }
  >();

  for (const entry of entries) {
    apparentBytes += entry.apparentBytes;

    if (entry.isDirectory || !entry.inodeKey || entry.linkCount <= 1) {
      reclaimableBytes += entry.diskBytes;
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
        apparentBytes: entry.apparentBytes,
      });
    }
  }

  for (const group of linked.values()) {
    if (group.linkCount <= group.count) {
      reclaimableBytes += group.diskBytes;
    }
  }

  return { apparentBytes, reclaimableBytes };
}

async function scanPath(state: ScanState, currentPath: string): Promise<void> {
  let stats: Stats;
  try {
    stats = await lstat(currentPath);
  } catch (error) {
    state.errors.push({
      type: 'stat-failed',
      path: currentPath,
      message: errorMessage(error),
    });
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
    state.errors.push({
      type: 'read-failed',
      path: currentPath,
      message: errorMessage(error),
    });
    return;
  }

  for (const child of children) {
    await scanPath(state, path.join(currentPath, child.name));
  }
}

export async function measureTaskStorage(targetPath: string): Promise<PathStorageUsage> {
  let rootStats: Stats;
  try {
    rootStats = await lstat(targetPath);
  } catch (error) {
    return createEmptyUsage(targetPath, false, false, [
      { type: 'not-found', path: targetPath, message: errorMessage(error) },
    ]);
  }

  if (!rootStats.isDirectory()) {
    return createEmptyUsage(targetPath, true, false, [
      { type: 'not-directory', path: targetPath, message: 'Path is not a directory.' },
    ]);
  }

  const state: ScanState = {
    entries: [],
    errors: [],
  };

  await scanPath(state, targetPath);

  const total = aggregateEntries(state.entries);
  return {
    path: targetPath,
    exists: true,
    isDirectory: true,
    apparentBytes: total.apparentBytes,
    reclaimableBytes: total.reclaimableBytes,
    errors: state.errors,
  };
}
