import path from 'node:path';
import type { IFilesRuntime } from '@main/core/runtime/types';
import { log } from '@main/lib/logger';

export function normalizeLocalWorkspacePath(
  workspacePath: string,
  serviceName: string
): string | null {
  if (!path.isAbsolute(workspacePath)) {
    log.warn(`${serviceName}: refusing to auto-trust non-absolute workspace path`, {
      path: workspacePath,
    });
    return null;
  }

  return path.normalize(workspacePath);
}

export async function normalizeSshWorkspacePath(
  files: IFilesRuntime,
  workspacePath: string,
  serviceName: string
): Promise<string | null> {
  if (!files.path.isAbsolute(workspacePath)) {
    log.warn(`${serviceName}: refusing to auto-trust non-absolute workspace path`, {
      path: workspacePath,
    });
    return null;
  }

  const opened = files.fileSystem();
  if (!opened.success) {
    log.warn(`${serviceName}: failed to open filesystem for workspace trust`, {
      path: workspacePath,
      error: opened.error.message,
    });
    return null;
  }

  const realPath = await opened.data.realPath(workspacePath);
  return realPath.success ? realPath.data : path.posix.normalize(workspacePath);
}
