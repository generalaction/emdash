import type { Stats } from 'node:fs';
import { lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';

export type PathUsageError = {
  path: string;
  message: string;
};

export type PathUsage = {
  path: string;
  type: 'file' | 'directory';
  apparentBytes: number;
  diskBytes: number;
  exclusiveDiskBytes: number;
  artifactBytes: number;
  errors: PathUsageError[];
};

export type MeasurePathUsageOptions = {
  /** Root-relative paths (forward slashes) whose subtrees count as artifact bytes. */
  artifactRoots?: string[];
  /** Absolute paths skipped entirely, e.g. nested workspaces measured on their own. */
  excludePaths?: string[];
  signal?: AbortSignal;
  /** Longest synchronous stretch before yielding to the event loop; tests shrink it. */
  sliceBudgetMs?: number;
};

/**
 * Synchronous `lstat`/`readdir` cost about a third of the CPU of the promise API on large
 * trees: the promise API pays a thread-pool round trip per entry, which dominated scans
 * of big `node_modules` trees. Short slices keep the hosting runtime responsive and are
 * where cancellation is observed.
 */
const DEFAULT_SLICE_BUDGET_MS = 8;

/** A visit still to make; `relativePath` is tracked only while artifact roots may lie below. */
type PendingEntry = {
  absolutePath: string;
  relativePath: string | null;
  isArtifact: boolean;
};

type ArtifactMatcher = {
  roots: Set<string>;
  /** Every proper ancestor of a root: the only directories whose children need a lookup. */
  ancestors: Set<string>;
};

type LinkedInode = {
  linkCount: number;
  diskBytes: number;
  seen: number;
  seenAsArtifact: number;
};

export async function measureAbsolutePathUsage(
  absolutePath: string,
  displayPath: string,
  options: MeasurePathUsageOptions = {}
): Promise<PathUsage> {
  options.signal?.throwIfAborted();
  const root = path.resolve(absolutePath);
  const rootStats = lstatSync(root);

  if (!rootStats.isDirectory()) {
    const bytes = diskBytes(rootStats);
    return {
      path: displayPath,
      type: 'file',
      apparentBytes: rootStats.size,
      diskBytes: bytes,
      exclusiveDiskBytes: rootStats.nlink > 1 ? 0 : bytes,
      artifactBytes: 0,
      errors: [],
    };
  }

  const sliceBudgetMs = options.sliceBudgetMs ?? DEFAULT_SLICE_BUDGET_MS;
  const matcher = createArtifactMatcher(options.artifactRoots ?? []);
  const excluded = new Set(
    (options.excludePaths ?? []).map((excludedPath) => path.resolve(excludedPath))
  );
  const errors: PathUsageError[] = [];
  const linked = new Map<string, LinkedInode>();
  let apparentBytes = 0;
  let diskBytesTotal = 0;
  let exclusiveDiskBytes = 0;
  let artifactBytes = 0;

  const pending: PendingEntry[] = [
    { absolutePath: root, relativePath: matcher.roots.size > 0 ? '' : null, isArtifact: false },
  ];
  let sliceStartedAt = performance.now();
  while (pending.length > 0) {
    if (performance.now() - sliceStartedAt >= sliceBudgetMs) {
      await yieldToEventLoop();
      options.signal?.throwIfAborted();
      sliceStartedAt = performance.now();
    }
    const entry = pending.pop()!;

    let stats: Stats;
    try {
      stats = lstatSync(entry.absolutePath);
    } catch (error) {
      errors.push({
        path: displayRelativePath(root, displayPath, entry),
        message: errorMessage(error),
      });
      continue;
    }

    const isDirectory = stats.isDirectory();
    const bytes = diskBytes(stats);
    apparentBytes += stats.size;
    if (isDirectory || stats.nlink <= 1 || stats.ino === 0) {
      diskBytesTotal += bytes;
      exclusiveDiskBytes += bytes;
      if (entry.isArtifact) artifactBytes += bytes;
    } else {
      // A hard-linked file is exclusive only when every link lives inside the scan.
      const key = `${stats.dev}:${stats.ino}`;
      let inode = linked.get(key);
      if (!inode) {
        inode = { linkCount: stats.nlink, diskBytes: bytes, seen: 0, seenAsArtifact: 0 };
        linked.set(key, inode);
      }
      inode.seen += 1;
      if (entry.isArtifact) inode.seenAsArtifact += 1;
    }
    if (!isDirectory) continue;

    let names: string[];
    try {
      names = readdirSync(entry.absolutePath);
    } catch (error) {
      errors.push({
        path: displayRelativePath(root, displayPath, entry),
        message: errorMessage(error),
      });
      continue;
    }
    for (const name of names) {
      const childPath = path.join(entry.absolutePath, name);
      if (excluded.has(childPath)) continue;
      pending.push(childEntry(entry, name, childPath, matcher));
    }
  }

  for (const inode of linked.values()) {
    diskBytesTotal += inode.diskBytes;
    if (inode.linkCount <= inode.seen) exclusiveDiskBytes += inode.diskBytes;
    if (inode.linkCount <= inode.seenAsArtifact) artifactBytes += inode.diskBytes;
  }
  return {
    path: displayPath,
    type: 'directory',
    apparentBytes,
    diskBytes: diskBytesTotal,
    exclusiveDiskBytes,
    artifactBytes,
    errors,
  };
}

function createArtifactMatcher(artifactRoots: string[]): ArtifactMatcher {
  const roots = new Set(
    artifactRoots
      .map((root) => root.trim().replace(/\\/gu, '/').replace(/\/+$/u, ''))
      .filter((root) => root && root !== '.' && root !== '..')
  );
  const ancestors = new Set<string>();
  for (const root of roots) {
    for (let index = root.indexOf('/'); index !== -1; index = root.indexOf('/', index + 1)) {
      ancestors.add(root.slice(0, index));
    }
  }
  return { roots, ancestors };
}

function childEntry(
  parent: PendingEntry,
  name: string,
  absolutePath: string,
  matcher: ArtifactMatcher
): PendingEntry {
  if (parent.isArtifact) return { absolutePath, relativePath: null, isArtifact: true };
  if (parent.relativePath === null) return { absolutePath, relativePath: null, isArtifact: false };
  const relativePath = parent.relativePath ? `${parent.relativePath}/${name}` : name;
  const isArtifact = matcher.roots.has(relativePath);
  return {
    absolutePath,
    relativePath: !isArtifact && matcher.ancestors.has(relativePath) ? relativePath : null,
    isArtifact,
  };
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function displayRelativePath(root: string, displayPath: string, entry: PendingEntry): string {
  const relative = path.relative(root, entry.absolutePath);
  if (!relative) return displayPath;
  const suffix = relative.split(path.sep).join('/');
  return displayPath ? `${displayPath}/${suffix}` : suffix;
}

function diskBytes(stats: Stats): number {
  return stats.blocks > 0 ? stats.blocks * 512 : stats.size;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
