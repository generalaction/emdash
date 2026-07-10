import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FileEnumerationOptions, FsError, PathBatch, PathList } from '@emdash/core/files';
import { err, ok, type Result } from '@emdash/shared';
import type { LiveJobContext } from '@emdash/wire';
import { toFsError } from '../api/errors';
import type { RootResource } from '../root/root-resource';
import { containsPath } from './path-policy';

const PROGRESS_BATCH_SIZE = 100;

export async function enumerateFiles(
  root: RootResource,
  entryPath: string,
  options: FileEnumerationOptions,
  context: LiveJobContext<PathBatch>
): Promise<Result<PathList, FsError>> {
  const entry = await root.paths.resolveExistingEntry(entryPath);
  if (!entry.success) return entry;

  try {
    const metadata = await lstat(entry.data.absolutePath);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      return err({ type: 'not-a-directory', path: entry.data.path });
    }
    const followed = await root.paths.resolveFollowed(entry.data.path);
    if (!followed.success) return followed;

    const paths: string[] = [];
    const pending: string[] = [];
    const emit = (filePath: string) => {
      paths.push(filePath);
      pending.push(filePath);
      if (pending.length >= PROGRESS_BATCH_SIZE) context.progress({ paths: pending.splice(0) });
    };

    await visitDirectory(
      followed.data.realPath,
      entry.data.path,
      async (absolute, relative, kind) => {
        if (context.signal.aborted) return false;
        if (kind === 'file') emit(relative);
        if (kind !== 'symlink' || options.includeSymlinkFiles === false) return true;
        try {
          const canonical = await realpath(absolute);
          if (!containsPath(root.identity.rootPath, canonical)) return true;
          if ((await stat(absolute)).isFile()) emit(relative);
        } catch {
          // Broken and unreadable symlinks are not enumeration results.
        }
        return true;
      }
    );
    if (pending.length > 0) context.progress({ paths: pending });
    return ok({ paths });
  } catch (error) {
    return err(toFsError(error, entry.data.path));
  }
}

async function visitDirectory(
  absoluteDirectory: string,
  relativeDirectory: string,
  visit: (
    absolutePath: string,
    relativePath: string,
    kind: 'file' | 'directory' | 'symlink'
  ) => Promise<boolean>
): Promise<boolean> {
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolute = path.join(absoluteDirectory, entry.name);
    const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!(await visit(absolute, relative, 'directory'))) return false;
      if (!(await visitDirectory(absolute, relative, visit))) return false;
    } else if (entry.isFile()) {
      if (!(await visit(absolute, relative, 'file'))) return false;
    } else if (entry.isSymbolicLink() && !(await visit(absolute, relative, 'symlink'))) {
      return false;
    }
  }
  return true;
}
