import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isFileNotFoundException, type IFileSystem } from '@emdash/core/files';
import { err, ok, type Result } from '@emdash/shared';
import { appSettingsService } from '@main/core/settings/settings-service';
import { resolveRemoteHome } from '@main/core/ssh/lifecycle/remote-shell-profile';
import { log } from '@main/lib/logger';
import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import { normalizeLocalWorkspacePath, normalizeSshWorkspacePath } from './workspace-trust-paths';
import type { WorkspaceTrustLocalArgs, WorkspaceTrustSshArgs } from './workspace-trust-types';

const CURSOR_PROVIDER_ID: AgentProviderId = 'cursor';
const CURSOR_DATA_DIR_NAME = '.cursor';
const CURSOR_PROJECTS_DIR_NAME = 'projects';
const CURSOR_TRUST_MARKER_NAME = '.workspace-trusted';

export class CursorTrustService {
  constructor(
    private readonly deps: {
      getTaskSettings: () => Promise<{ autoTrustWorktrees: boolean }>;
    }
  ) {}

  async maybeAutoTrustLocal({
    providerId,
    workspacePath,
    homedir,
    force = false,
  }: WorkspaceTrustLocalArgs): Promise<void> {
    if (!(await this.shouldAutoTrust(providerId, force))) return;

    const normalizedWorkspacePath = normalizeLocalWorkspacePath(
      workspacePath,
      'CursorTrustService'
    );
    if (!normalizedWorkspacePath) return;
    const dataDir = path.join(homedir, CURSOR_DATA_DIR_NAME);
    const markerPath = path.join(
      cursorProjectDir(normalizedWorkspacePath, dataDir, path),
      CURSOR_TRUST_MARKER_NAME
    );

    await this.ensureTrusted(markerPath, normalizedWorkspacePath, {
      exists: () => localExists(markerPath),
      write: (content) => writeLocalMarker(markerPath, content),
    });
  }

  async maybeAutoTrustSsh({
    providerId,
    workspacePath,
    ctx,
    files,
    force = false,
  }: WorkspaceTrustSshArgs): Promise<void> {
    if (!(await this.shouldAutoTrust(providerId, force))) return;

    const normalizedWorkspacePath = await normalizeSshWorkspacePath(
      files,
      workspacePath,
      'CursorTrustService'
    );
    if (!normalizedWorkspacePath) return;
    const homeDir = await resolveRemoteHome(ctx);
    const homeFs = files.fileSystem();
    if (!homeFs.success) {
      log.warn('CursorTrustService: failed to open filesystem for auto-trust', {
        path: normalizedWorkspacePath,
        error: homeFs.error.message,
      });
      return;
    }
    const dataDir = path.posix.join(homeDir, CURSOR_DATA_DIR_NAME);
    const markerPath = path.posix.join(
      cursorProjectDir(normalizedWorkspacePath, dataDir, path.posix),
      CURSOR_TRUST_MARKER_NAME
    );

    await this.ensureTrusted(markerPath, normalizedWorkspacePath, {
      exists: () => remoteExists(homeFs.data, markerPath),
      write: (content) => writeRemoteText(homeFs.data, markerPath, content),
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
      exists: () => Promise<TrustIoResult<boolean>>;
      write: (content: string) => Promise<TrustIoResult<void>>;
    }
  ): Promise<void> {
    try {
      const exists = await io.exists();
      if (!exists.success) {
        log.warn('CursorTrustService: failed to check auto-trust marker', {
          path: workspacePath,
          markerPath,
          error: exists.error.message,
        });
        return;
      }
      if (exists.data) return;

      const written = await io.write(
        JSON.stringify(createTrustMarker(workspacePath), null, 2) + '\n'
      );
      if (!written.success) {
        log.warn('CursorTrustService: failed to write auto-trust marker', {
          path: workspacePath,
          markerPath,
          error: written.error.message,
        });
      }
    } catch (error: unknown) {
      log.warn('CursorTrustService: failed to auto-trust worktree', {
        path: workspacePath,
        markerPath,
        error: String(error),
      });
    }
  }
}

type TrustIoError = { message: string };
type TrustIoResult<T> = Result<T, TrustIoError>;

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

async function localExists(markerPath: string): Promise<TrustIoResult<boolean>> {
  try {
    await fs.access(markerPath);
    return ok(true);
  } catch (error: unknown) {
    if (isFileNotFoundException(error)) return ok(false);
    return err({ message: errorMessage(error) });
  }
}

async function remoteExists(
  remoteFs: Pick<IFileSystem, 'exists'>,
  markerPath: string
): Promise<TrustIoResult<boolean>> {
  return remoteFs.exists(markerPath);
}

async function writeLocalMarker(markerPath: string, content: string): Promise<TrustIoResult<void>> {
  try {
    await fs.mkdir(path.dirname(markerPath), { recursive: true });
    await fs.writeFile(markerPath, content, 'utf8');
    return ok();
  } catch (error: unknown) {
    return err({ message: errorMessage(error) });
  }
}

async function writeRemoteText(
  remoteFs: Pick<IFileSystem, 'writeText'>,
  absPath: string,
  content: string
): Promise<TrustIoResult<void>> {
  const result = await remoteFs.writeText(absPath, content);
  return result.success ? ok() : result;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
