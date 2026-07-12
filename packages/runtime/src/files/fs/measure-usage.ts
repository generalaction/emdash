import type { Stats } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { FileUsage, FileUsageError, FsError } from '@emdash/core/files';
import type { PortableRelativePath } from '@emdash/core/path';
import { err, ok, type Result } from '@emdash/shared';
import { toFsError } from '../api/errors';
import type { RootPathPolicy } from './path-policy';

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

export async function measurePathUsage(
  paths: RootPathPolicy,
  targetPath: PortableRelativePath
): Promise<Result<FileUsage, FsError>> {
  const resolved = await paths.resolveExistingEntry(targetPath);
  if (!resolved.success) return resolved;

  let rootStats: Stats;
  try {
    rootStats = await lstat(resolved.data.absolutePath);
  } catch (error) {
    return err(toFsError(error, targetPath));
  }

  if (!rootStats.isDirectory()) {
    const bytes = diskBytes(rootStats);
    return ok({
      path: targetPath,
      type: 'file',
      apparentBytes: rootStats.size,
      diskBytes: bytes,
      exclusiveDiskBytes: rootStats.nlink > 1 ? 0 : bytes,
      errors: [],
    });
  }

  const state: ScanState = { entries: [], errors: [] };
  await scanPath(paths, state, resolved.data.absolutePath, targetPath);
  return ok({
    path: targetPath,
    type: 'directory',
    ...aggregateEntries(state.entries),
    errors: state.errors,
  });
}

async function scanPath(
  paths: RootPathPolicy,
  state: ScanState,
  currentPath: string,
  fallbackPath: PortableRelativePath
): Promise<void> {
  const relative = paths.toRelative(currentPath) ?? fallbackPath;
  let stats: Stats;
  try {
    stats = await lstat(currentPath);
  } catch (error) {
    state.errors.push({ path: relative, message: errorMessage(error) });
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
    state.errors.push({ path: relative, message: errorMessage(error) });
    return;
  }
  for (const child of children) {
    await scanPath(paths, state, path.join(currentPath, child.name), relative);
  }
}

function aggregateEntries(entries: EntryUsage[]) {
  let apparentBytes = 0;
  let diskBytesTotal = 0;
  let exclusiveDiskBytes = 0;
  const linked = new Map<string, { count: number; linkCount: number; diskBytes: number }>();

  for (const entry of entries) {
    apparentBytes += entry.apparentBytes;
    if (entry.isDirectory || !entry.inodeKey || entry.linkCount <= 1) {
      diskBytesTotal += entry.diskBytes;
      exclusiveDiskBytes += entry.diskBytes;
      continue;
    }
    const existing = linked.get(entry.inodeKey);
    if (existing) existing.count += 1;
    else {
      linked.set(entry.inodeKey, {
        count: 1,
        linkCount: entry.linkCount,
        diskBytes: entry.diskBytes,
      });
    }
  }

  for (const group of linked.values()) {
    diskBytesTotal += group.diskBytes;
    if (group.linkCount <= group.count) exclusiveDiskBytes += group.diskBytes;
  }
  return { apparentBytes, diskBytes: diskBytesTotal, exclusiveDiskBytes };
}

function diskBytes(stats: Stats): number {
  return stats.blocks > 0 ? stats.blocks * 512 : stats.size;
}

function inodeKey(stats: Stats): string | null {
  return stats.ino === 0 ? null : `${stats.dev}:${stats.ino}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
