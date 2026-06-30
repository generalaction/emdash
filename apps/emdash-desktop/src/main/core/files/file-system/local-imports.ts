import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { IFileSystem } from '@emdash/core/files';
import { err, ok } from '@emdash/shared';
import {
  containsMachinePath,
  displayPathInDirectory,
  isAbsoluteMachinePath,
  joinMachinePath,
} from '../path-utils';
import { fileErrorToMessage } from './file-errors';

type CopyLocalFilesError =
  | { type: 'fs_error'; message: string }
  | { type: 'conflict'; message: string; paths: string[] };

function normalizeRelativePath(filePath: string, options?: { allowEmpty?: boolean }): string {
  if (filePath.includes('\0')) throw new Error('Path contains a null byte');
  const normalized = path.posix.normalize(filePath.replace(/\\/g, '/'));
  if (normalized === '.') {
    if (options?.allowEmpty) return '';
    throw new Error('Path must not be empty');
  }
  if (path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) {
    throw new Error('Path must be relative');
  }
  const parts = normalized.split('/').filter(Boolean);
  if (parts.includes('..')) throw new Error('Parent path segments are not allowed');
  return parts.join('/');
}

function resolveWorkspacePath(
  workspacePath: string,
  filePath: string,
  options?: { allowEmpty?: boolean }
): string {
  const absPath = isAbsoluteMachinePath(filePath)
    ? filePath
    : (() => {
        const workspaceRelativePath = normalizeRelativePath(filePath, options);
        return workspaceRelativePath
          ? joinMachinePath(workspacePath, workspaceRelativePath)
          : workspacePath;
      })();
  if (!containsMachinePath(workspacePath, absPath)) {
    throw new Error('Destination path must be inside the workspace');
  }
  return absPath;
}

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
    const destDirAbsPath = resolveWorkspacePath(workspacePath, destDirPath, {
      allowEmpty: true,
    });
    const destDirDisplayPath = displayPathInDirectory(workspacePath, destDirAbsPath);
    const madeDir = await fileSystem.mkdir(destDirAbsPath, { recursive: true });
    if (!madeDir.success) {
      return err({ type: 'fs_error' as const, message: fileErrorToMessage(madeDir.error) });
    }

    const plannedCopies = await Promise.all(
      srcPaths.map(async (srcPath) => {
        if (!path.isAbsolute(srcPath)) throw new Error('Source path must be absolute');
        const fileName = path.basename(srcPath);
        if (!fileName) throw new Error('Source path must include a file name');
        const srcStat = await fs.stat(srcPath);
        if (srcStat.isDirectory()) throw new Error(`Cannot import directories: ${srcPath}`);
        const destDisplayPath = destDirDisplayPath
          ? path.posix.join(destDirDisplayPath, fileName)
          : fileName;
        const destAbsPath = joinMachinePath(destDirAbsPath, fileName);
        return { srcPath, destDisplayPath, destAbsPath };
      })
    );

    const seenDestPaths = new Set<string>();
    const conflicts: string[] = [];
    for (const { destDisplayPath, destAbsPath } of plannedCopies) {
      if (seenDestPaths.has(destDisplayPath)) {
        throw new Error(`Duplicate destination: ${destDisplayPath}`);
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
