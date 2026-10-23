import { lstat, readdir, readlink, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import {
  joinPortableRelativePath,
  portableRelativePathBasename,
  type PortableRelativePath,
} from '#primitives/path/api';
import type { FsError, ListingEntry, SymlinkTargetKind } from '#runtimes/files/api';
import { toFsError } from '#runtimes/files/node/api/errors';
import { containsPath, type RootPathPolicy } from '#runtimes/files/node/fs/path-policy';

const ENTRY_READ_CONCURRENCY = 8;

/** A child as read from disk: its listing entry plus metadata only folder browsers show. */
export type ReadEntry = {
  name: string;
  entry: ListingEntry;
  size: number;
  mtimeMs: number;
};

export class ListingReader {
  constructor(private readonly paths: RootPathPolicy) {}

  /** Reads a folder's children. Children that disappear while it is read are left out. */
  async readFolder(folderPath: PortableRelativePath): Promise<Result<ReadEntry[], FsError>> {
    const resolved = await this.paths.resolveFollowed(folderPath);
    if (!resolved.success) return resolved;

    let names: string[];
    try {
      names = await readdir(resolved.data.realPath);
    } catch (error) {
      return err(toFsError(error, folderPath));
    }

    const children = names.flatMap((name) => {
      const childPath = joinPortableRelativePath(folderPath, name);
      return childPath.success
        ? [{ path: childPath.data, canonical: path.join(resolved.data.realPath, name) }]
        : [];
    });
    const results = await mapWithConcurrency(children, ENTRY_READ_CONCURRENCY, (child) =>
      this.readEntry(child.path, child.canonical)
    );
    const entries: ReadEntry[] = [];
    for (const result of results) {
      if (result.success) entries.push(result.data);
      else if (result.error.type !== 'not-found') return result;
    }
    return ok(entries);
  }

  /** Reads one entry; anything other than a file, folder or link reads as not found. */
  async readEntry(
    entryPath: PortableRelativePath,
    canonicalPath?: string
  ): Promise<Result<ReadEntry, FsError>> {
    const resolved = this.paths.resolveEntry(entryPath);
    if (!resolved.success) return resolved;

    try {
      const absolutePath = canonicalPath ?? resolved.data.absolutePath;
      const metadata = await lstat(absolutePath);
      const base = {
        name: portableRelativePathBasename(resolved.data.path),
        size: metadata.size,
        mtimeMs: metadata.mtimeMs,
      };
      if (metadata.isSymbolicLink()) {
        const target = await classifySymlink(absolutePath, this.paths.rootPath);
        return ok({
          ...base,
          entry: {
            kind: 'symlink',
            symlinkTarget: target.target,
            symlinkTargetKind: target.kind,
            symlinkTargetOutsideRoot: target.outsideRoot,
          },
        });
      }
      if (metadata.isDirectory()) return ok({ ...base, entry: { kind: 'directory' } });
      if (metadata.isFile()) return ok({ ...base, entry: { kind: 'file' } });
      return err({ type: 'not-found', path: resolved.data.path });
    } catch (error) {
      return err(toFsError(error, resolved.data.path));
    }
  }
}

/** Maps items with at most `limit` operations in flight, preserving order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  map: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await map(items[index]!);
      }
    })
  );
  return results;
}

async function classifySymlink(
  absolutePath: string,
  rootPath: string
): Promise<{
  target: string | null;
  kind: SymlinkTargetKind;
  outsideRoot: boolean;
}> {
  let target: string | null = null;
  try {
    target = await readlink(absolutePath);
  } catch {
    // The entry remains useful even when its raw target cannot be read.
  }

  try {
    const metadata = await stat(absolutePath);
    const canonical = await realpath(absolutePath);
    const outsideRoot = !containsPath(rootPath, canonical);
    if (metadata.isDirectory()) return { target, kind: 'directory', outsideRoot };
    if (metadata.isFile()) return { target, kind: 'file', outsideRoot };
    return { target, kind: 'other', outsideRoot };
  } catch (error) {
    return {
      target,
      kind: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'other',
      outsideRoot: false,
    };
  }
}
