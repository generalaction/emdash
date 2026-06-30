import { lstat, readdir, readlink, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import { includeAllFiles, type FileExclusionPredicate } from '../exclusions';
import type { RootPathPolicy } from '../path-policy';
import type { FileSymlinkInfo, FileSymlinkTargetType } from '../symlinks';
import { classifyFileTreeFsError, type FileTreeError } from './errors';
import type { FileNodeType } from './models/tree';

export type DevIno = `${number}:${number}`;

type DirectoryEntryBase = {
  path: string;
  name: string;
  devIno?: DevIno;
};

export type DirectoryEntry =
  | (DirectoryEntryBase & {
      type: Exclude<FileNodeType, 'symlink'>;
      symlink?: never;
    })
  | (DirectoryEntryBase & {
      type: 'symlink';
      symlink: FileSymlinkInfo;
    });

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
        const absPath = path.join(resolvedDir.data, entry.name);
        if (exclude(absPath)) continue;
        const classified = await directoryEntryFromDirent(absPath, entry.name, {
          isFile: entry.isFile(),
          isDirectory: entry.isDirectory(),
          isSymbolicLink: entry.isSymbolicLink(),
        });
        if (classified) candidates.push(classified);
      }

      const listed = options.includeDevIno ? await withDevInos(candidates) : candidates;

      if (options.sort ?? false) {
        listed.sort((a, b) => {
          const rankDiff = directoryEntrySortRank(a) - directoryEntrySortRank(b);
          if (rankDiff !== 0) return rankDiff;
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
        if (stats.isSymbolicLink()) {
          const symlink = await symlinkInfo(resolvedPath.data);
          return ok({
            path: resolvedPath.data,
            name: path.basename(resolvedPath.data),
            type: 'symlink',
            symlink,
            devIno: toDevIno(stats.dev, stats.ino),
          });
        }
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

type DirentFacts = {
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
};

async function directoryEntryFromDirent(
  absPath: string,
  name: string,
  facts: DirentFacts
): Promise<DirectoryEntry | null> {
  if (facts.isFile) return { path: absPath, name, type: 'file' };
  if (facts.isDirectory) return { path: absPath, name, type: 'directory' };
  if (!facts.isSymbolicLink) return null;

  return {
    path: absPath,
    name,
    type: 'symlink',
    symlink: await symlinkInfo(absPath),
  };
}

async function symlinkInfo(absPath: string): Promise<FileSymlinkInfo> {
  let targetPath: string | undefined;
  try {
    targetPath = await readlink(absPath);
  } catch {
    targetPath = undefined;
  }

  try {
    const targetStat = await stat(absPath);
    return {
      ...(targetPath !== undefined ? { targetPath } : {}),
      ...(await realPathOrUndefined(absPath)),
      targetType: targetTypeForStat(targetStat),
      broken: false,
    };
  } catch {
    return {
      ...(targetPath !== undefined ? { targetPath } : {}),
      targetType: 'unknown',
      broken: true,
    };
  }
}

async function realPathOrUndefined(absPath: string): Promise<{ realPath: string } | {}> {
  try {
    return { realPath: await realpath(absPath) };
  } catch {
    return {};
  }
}

function targetTypeForStat(stats: Awaited<ReturnType<typeof stat>>): FileSymlinkTargetType {
  if (stats.isFile()) return 'file';
  if (stats.isDirectory()) return 'directory';
  return 'other';
}

function directoryEntrySortRank(entry: DirectoryEntry): number {
  if (entry.type === 'directory') return 0;
  if (
    entry.type === 'symlink' &&
    !entry.symlink.broken &&
    entry.symlink.targetType === 'directory'
  ) {
    return 0;
  }
  return 1;
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
