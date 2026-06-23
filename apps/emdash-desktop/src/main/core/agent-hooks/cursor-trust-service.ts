import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { IExecutionContext } from '@main/core/execution-context/types';
import {
  FileSystemError,
  FileSystemErrorCodes,
  type FileSystemProvider,
} from '@main/core/fs/types';
import { appSettingsService } from '@main/core/settings/settings-service';
import { resolveRemoteHome } from '@main/core/ssh/lifecycle/remote-shell-profile';
import { log } from '@main/lib/logger';
import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';

const CURSOR_PROVIDER_ID: AgentProviderId = 'cursor';
const CURSOR_DATA_DIR_NAME = '.cursor';
const CURSOR_PROJECTS_DIR_NAME = 'projects';
const CURSOR_TRUST_MARKER_NAME = '.workspace-trusted';
const CURSOR_TRUST_MARKER_MAX_BYTES = 1024;

export class CursorTrustService {
  constructor(
    private readonly deps: {
      getTaskSettings: () => Promise<{ autoTrustWorktrees: boolean }>;
    }
  ) {}

  async maybeAutoTrustLocal({
    providerId,
    cwd,
    homedir,
    force = false,
  }: {
    providerId: AgentProviderId;
    cwd?: string;
    homedir: string;
    force?: boolean;
  }): Promise<void> {
    if (!cwd) return;
    if (!(await this.shouldAutoTrust(providerId, force))) return;

    const workspacePath = path.resolve(cwd);
    const dataDir = path.join(homedir, CURSOR_DATA_DIR_NAME);
    const markerPath = path.join(
      cursorProjectDir(workspacePath, dataDir, path),
      CURSOR_TRUST_MARKER_NAME
    );

    await this.ensureTrusted(markerPath, workspacePath, {
      exists: () => localExists(markerPath),
      write: (content) => writeLocalMarker(markerPath, content),
    });
  }

  async maybeAutoTrustSsh({
    providerId,
    cwd,
    ctx,
    remoteFs,
    force = false,
  }: {
    providerId: AgentProviderId;
    cwd?: string;
    ctx: IExecutionContext;
    remoteFs: Pick<FileSystemProvider, 'realPath' | 'read' | 'write'>;
    force?: boolean;
  }): Promise<void> {
    if (!cwd) return;
    if (!(await this.shouldAutoTrust(providerId, force))) return;

    const workspacePath = await remoteFs.realPath(cwd).catch(() => path.posix.resolve('/', cwd));
    const homeDir = await resolveRemoteHome(ctx);
    const dataDir = path.posix.join(homeDir, CURSOR_DATA_DIR_NAME);
    const markerPath = path.posix.join(
      cursorProjectDir(workspacePath, dataDir, path.posix),
      CURSOR_TRUST_MARKER_NAME
    );

    await this.ensureTrusted(markerPath, workspacePath, {
      exists: () => remoteExists(remoteFs, markerPath),
      write: (content) => remoteFs.write(markerPath, content).then(() => undefined),
    });
  }

  private async shouldAutoTrust(providerId: AgentProviderId, force: boolean): Promise<boolean> {
    if (providerId !== CURSOR_PROVIDER_ID) return false;
    if (force) return true;
    const { autoTrustWorktrees } = await this.deps.getTaskSettings();
    return autoTrustWorktrees;
  }

  private async ensureTrusted(
    markerPath: string,
    workspacePath: string,
    io: {
      exists: () => Promise<boolean>;
      write: (content: string) => Promise<void>;
    }
  ): Promise<void> {
    try {
      if (await io.exists()) return;

      await io.write(JSON.stringify(createTrustMarker(workspacePath), null, 2) + '\n');
    } catch (error: unknown) {
      log.warn('CursorTrustService: failed to auto-trust worktree', {
        path: workspacePath,
        markerPath,
        error: String(error),
      });
    }
  }
}

export const cursorTrustService = new CursorTrustService({
  getTaskSettings: () => appSettingsService.get('tasks'),
});

function createTrustMarker(workspacePath: string): Record<string, string> {
  return {
    trustedAt: new Date().toISOString(),
    workspacePath,
    trustMethod: 'emdash-auto-trust',
  };
}

function cursorProjectDir(
  workspacePath: string,
  dataDir: string,
  pathImpl: Pick<typeof path, 'join'>
): string {
  // Mirrors Cursor CLI's workspace trust lookup: cursor-config Xq(workspacePath).
  return pathImpl.join(dataDir, CURSOR_PROJECTS_DIR_NAME, slugifyPath(workspacePath));
}

function slugifyPath(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function localExists(markerPath: string): Promise<boolean> {
  try {
    await fs.access(markerPath);
    return true;
  } catch (error: unknown) {
    if (isNodeNotFound(error)) return false;
    throw error;
  }
}

async function remoteExists(
  remoteFs: Pick<FileSystemProvider, 'read'>,
  markerPath: string
): Promise<boolean> {
  try {
    await remoteFs.read(markerPath, CURSOR_TRUST_MARKER_MAX_BYTES);
    return true;
  } catch (error: unknown) {
    if (isFsNotFound(error)) return false;
    throw error;
  }
}

async function writeLocalMarker(markerPath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(markerPath), { recursive: true });
  await fs.writeFile(markerPath, content, 'utf8');
}

function isNodeNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

function isFsNotFound(error: unknown): boolean {
  return error instanceof FileSystemError && error.code === FileSystemErrorCodes.NOT_FOUND;
}
