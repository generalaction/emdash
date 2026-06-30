import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { IFileSystem } from '@emdash/core/files';
import { err, ok } from '@emdash/shared';
import { displayPathInDirectory, joinMachinePath } from '../path-utils';
import { fileErrorToMessage } from './file-errors';
import {
  assertWorkspaceDirectoryTargetAllowed,
  assertWorkspaceWriteAllowed,
} from './workspace-file-policy';

type CopyLocalFilesError =
  | { type: 'fs_error'; message: string }
  | { type: 'conflict'; message: string; paths: string[] };

type PlannedCopy = {
  srcPath: string;
  destDisplayPath: string;
  destAbsPath: string;
};

export async function copyLocalFilesToWorkspace(
  fileSystem: IFileSystem,
  workspacePath: string,
  srcPaths: string[],
  destDirPath: string,
  options?: { overwrite?: boolean }
): Promise<
  { success: true; data: { copied: number } } | { success: false; error: CopyLocalFilesError }
> {
  try {
    const destDir = await assertWorkspaceDirectoryTargetAllowed(
      fileSystem,
      workspacePath,
      destDirPath
    );
    if (!destDir.success) {
      return err({ type: 'fs_error' as const, message: fileErrorToMessage(destDir.error) });
    }
    const destDirAbsPath = destDir.data.path;
    const destDirDisplayPath = displayPathInDirectory(workspacePath, destDirAbsPath);
    const madeDir = await fileSystem.mkdir(destDirAbsPath, { recursive: true });
    if (!madeDir.success) {
      return err({ type: 'fs_error' as const, message: fileErrorToMessage(madeDir.error) });
    }

    const plannedCopyResults = await Promise.all(
      srcPaths.map(
        async (
          srcPath
        ): Promise<{ success: true; data: PlannedCopy } | { success: false; error: string }> => {
          if (!path.isAbsolute(srcPath)) return err('Source path must be absolute');
          const fileName = path.basename(srcPath);
          if (!fileName) return err('Source path must include a file name');
          const srcStat = await fs.stat(srcPath);
          if (srcStat.isDirectory()) return err(`Cannot import directories: ${srcPath}`);
          const destDisplayPath = destDirDisplayPath
            ? path.posix.join(destDirDisplayPath, fileName)
            : fileName;
          const destAbsPath = joinMachinePath(destDirAbsPath, fileName);
          const writable = await assertWorkspaceWriteAllowed(
            fileSystem,
            workspacePath,
            destAbsPath
          );
          if (!writable.success) return err(fileErrorToMessage(writable.error));
          return ok({ srcPath, destDisplayPath, destAbsPath });
        }
      )
    );
    const plannedCopies: PlannedCopy[] = [];
    for (const result of plannedCopyResults) {
      if (!result.success) return err({ type: 'fs_error' as const, message: result.error });
      plannedCopies.push(result.data);
    }

    const seenDestPaths = new Set<string>();
    const conflicts: string[] = [];
    for (const { destDisplayPath, destAbsPath } of plannedCopies) {
      if (seenDestPaths.has(destDisplayPath)) {
        return err({
          type: 'fs_error' as const,
          message: `Duplicate destination: ${destDisplayPath}`,
        });
      }
      seenDestPaths.add(destDisplayPath);
      const exists = await fileSystem.exists(destAbsPath);
      if (!exists.success) {
        return err({ type: 'fs_error' as const, message: fileErrorToMessage(exists.error) });
      }
      if (!options?.overwrite && exists.data) conflicts.push(destDisplayPath);
    }
    if (conflicts.length > 0) {
      return err({ type: 'conflict' as const, message: 'Files already exist', paths: conflicts });
    }

    for (const { srcPath, destAbsPath } of plannedCopies) {
      const bytes = await fs.readFile(srcPath);
      const written = await fileSystem.writeBytes(destAbsPath, bytes);
      if (!written.success) {
        return err({ type: 'fs_error' as const, message: fileErrorToMessage(written.error) });
      }
    }

    return ok({ copied: srcPaths.length });
  } catch (e) {
    return err({ type: 'fs_error' as const, message: String(e) });
  }
}
