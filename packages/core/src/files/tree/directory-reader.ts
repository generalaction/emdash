import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import { includeAllFiles, type FileExclusionPredicate } from '../exclusions';
import type { RootPathPolicy } from '../path-policy';
import { classifyFileTreeFsError, type FileTreeError } from './errors';
import type { FileNodeType } from './models/tree';

export type DevIno = `${number}:${number}`;

export type DirectoryEntry = {
  path: string;
  name: string;
  type: FileNodeType;
  devIno?: DevIno;
};

export type DirectoryReadOptions = {
  includeDevIno?: boolean;
  softFail?: boolean;
  sort?: boolean;
  exclude?: FileExclusionPredicate;
};

export type DirectoryReadResult =
  | { kind: 'entries'; entries: DirectoryEntry[] }
  | { kind: 'unreadable' };

export type TreeDirectoryReader = {
  readChildren(
    dirPath: string,
    options?: DirectoryReadOptions
  ): Promise<Result<DirectoryReadResult, FileTreeError>>;
  statEntry(absPath: string): Promise<Result<DirectoryEntry, FileTreeError>>;
};

export function createTreeDirectoryReader(policy: RootPathPolicy): TreeDirectoryReader {
  return {
    async readChildren(
      dirPath: string,
      options: DirectoryReadOptions = {}
    ): Promise<Result<DirectoryReadResult, FileTreeError>> {
      const resolvedDir = policy.resolveInsideRoot(dirPath);
      if (!resolvedDir.success) {
        return options.softFail ? ok({ kind: 'unreadable' }) : resolvedDir;
      }

      let entries;
      try {
        entries = await readdir(resolvedDir.data, { withFileTypes: true });
      } catch (error) {
        if (options.softFail) return ok({ kind: 'unreadable' });
        return err(classifyFileTreeFsError(error, resolvedDir.data));
      }

      const exclude = options.exclude ?? includeAllFiles;
      const candidates: DirectoryEntry[] = [];
      for (const entry of entries) {
        if (!entry.isFile() && !entry.isDirectory()) continue;
        const absPath = path.join(resolvedDir.data, entry.name);
        if (exclude(absPath)) continue;
        candidates.push({
          path: absPath,
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
        });
      }

      const listed = options.includeDevIno ? await withDevInos(candidates) : candidates;

      if (options.sort ?? false) {
        listed.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      }

      return ok({ kind: 'entries', entries: listed });
    },

    async statEntry(absPath: string): Promise<Result<DirectoryEntry, FileTreeError>> {
      const resolvedPath = policy.resolveInsideRoot(absPath);
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
    },
  };
}

async function withDevInos(entries: DirectoryEntry[]): Promise<DirectoryEntry[]> {
  const devInos = await Promise.all(entries.map((entry) => statDevIno(entry.path)));
  return entries.map((entry, index) => ({ ...entry, devIno: devInos[index] }));
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
