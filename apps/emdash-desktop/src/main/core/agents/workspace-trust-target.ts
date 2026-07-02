import path from 'node:path';
import type { PluginFs } from '@emdash/core/agents/plugins';
import type { IFileSystem } from '@emdash/core/files';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { IFilesRuntime } from '@main/core/runtime/types';
import { resolveRemoteHome } from '@main/core/ssh/lifecycle/remote-shell-profile';
import { log } from '@main/lib/logger';
import { createPluginFs } from './plugin-fs';
import { createRemotePluginFs } from './remote-plugin-fs';

export type WorkspaceTrustHost =
  | { kind: 'local'; homedir: string }
  | { kind: 'ssh'; ctx: IExecutionContext; files: IFilesRuntime };

export type TrustTarget = {
  fs: PluginFs;
  lockKey: string;
  workspacePath: string;
};

export async function resolveTrustTarget(
  host: WorkspaceTrustHost,
  workspacePath: string
): Promise<TrustTarget | null> {
  if (host.kind === 'local') {
    const normalizedPath = normalizeLocalWorkspacePath(workspacePath);
    if (!normalizedPath) return null;
    return {
      fs: createPluginFs(host.homedir),
      lockKey: `local:${path.resolve(host.homedir)}`,
      workspacePath: normalizedPath,
    };
  }

  if (!isAbsoluteSshWorkspacePath(host.files, workspacePath)) return null;

  const opened = host.files.fileSystem();
  if (!opened.success) {
    log.warn('WorkspaceTrust: failed to open filesystem for workspace trust', {
      path: workspacePath,
      error: opened.error.message,
    });
    return null;
  }

  const normalizedPath = await normalizeSshWorkspacePath(opened.data, workspacePath);
  if (!normalizedPath) return null;
  const homeDir = await resolveRemoteHome(host.ctx);
  return {
    fs: createRemotePluginFs(host.ctx, opened.data, homeDir),
    lockKey: `ssh:${homeDir}`,
    workspacePath: normalizedPath,
  };
}

function normalizeLocalWorkspacePath(workspacePath: string): string | null {
  if (!path.isAbsolute(workspacePath)) {
    log.warn('WorkspaceTrust: refusing to auto-trust non-absolute workspace path', {
      path: workspacePath,
    });
    return null;
  }

  return path.normalize(workspacePath);
}

function isAbsoluteSshWorkspacePath(files: IFilesRuntime, workspacePath: string): boolean {
  if (!files.path.isAbsolute(workspacePath)) {
    log.warn('WorkspaceTrust: refusing to auto-trust non-absolute workspace path', {
      path: workspacePath,
    });
    return false;
  }

  return true;
}

async function normalizeSshWorkspacePath(
  remoteFs: IFileSystem,
  workspacePath: string
): Promise<string | null> {
  const realPath = await remoteFs.realPath(workspacePath);
  return realPath.success ? realPath.data : path.posix.normalize(workspacePath);
}
