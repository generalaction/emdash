import { isFileNotFoundError } from '@emdash/core/files';
import { err, ok, withLease } from '@emdash/shared';
import { runtimeManager } from '@main/core/runtime/runtime-manager';
import type { MachineRef } from '@main/core/runtime/types';
import type {
  BrowseDirectoryParams,
  BrowseDirectoryResult,
  DirectoryEntry,
} from '@shared/core/fs/fs';

export async function browseDirectory(
  params: BrowseDirectoryParams
): Promise<BrowseDirectoryResult> {
  return withLease(runtimeManager.acquire(machineForDirectory(params)), async (runtime) => {
    const files = runtime.files;
    if (!files.path.isAbsolute(params.path)) {
      return err({
        type: 'invalid-path',
        path: params.path,
        message: `Expected absolute path: ${params.path}`,
      });
    }

    const opened = files.fileSystem();
    if (!opened.success) {
      return err({
        type: 'filesystem-error',
        path: params.path,
        message: opened.error.message,
      });
    }

    const matched = opened.data.glob(['*'], { cwd: params.path, dot: true });
    if (!matched.success) {
      return err({
        type: 'filesystem-error',
        path: params.path,
        message: matched.error.message,
      });
    }

    const entries: DirectoryEntry[] = [];
    for await (const absPath of matched.data) {
      if (files.path.dirname(absPath) !== params.path) continue;

      const stat = await opened.data.stat(absPath);
      if (!stat.success) {
        if (isFileNotFoundError(stat.error)) continue;
        return err({
          type: 'filesystem-error',
          path: absPath,
          message: stat.error.message,
        });
      }

      entries.push({
        path: stat.data.path,
        name: files.path.basename(stat.data.path),
        type: stat.data.type,
        size: stat.data.size,
        modifiedAt: stat.data.mtime,
      });
    }

    return ok(entries.sort(compareDirectoryEntries));
  });
}

function machineForDirectory(params: BrowseDirectoryParams): MachineRef {
  if (params.type === 'local') return { kind: 'local' };
  return { kind: 'ssh', connectionId: params.connectionId };
}

function compareDirectoryEntries(left: DirectoryEntry, right: DirectoryEntry): number {
  if (left.type === 'directory' && right.type !== 'directory') return -1;
  if (left.type !== 'directory' && right.type === 'directory') return 1;
  return left.name.localeCompare(right.name);
}
