import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isFileNotFoundError, isFileNotFoundException, type IFileSystem } from '@emdash/core/files';
import { err, ok, type Result } from '@emdash/shared';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { appSettingsService } from '@main/core/settings/settings-service';
import { resolveRemoteHome } from '@main/core/ssh/lifecycle/remote-shell-profile';
import { log } from '@main/lib/logger';
import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import { normalizeLocalWorkspacePath, normalizeSshWorkspacePath } from './workspace-trust-paths';
import type { WorkspaceTrustLocalArgs, WorkspaceTrustSshArgs } from './workspace-trust-types';

const CLAUDE_PROVIDER_ID: AgentProviderId = 'claude';
const COPILOT_PROVIDER_ID: AgentProviderId = 'copilot';
const CLAUDE_CONFIG_NAME = '.claude.json';
const COPILOT_CONFIG_NAME = '.copilot/config.json';
const CLAUDE_CONFIG_MAX_BYTES = 2 * 1024 * 1024;

export class ClaudeTrustService {
  private readonly configLocks = new Map<string, Promise<void>>();

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
    const trustConfig = await this.getTrustConfig(providerId, force);
    if (!trustConfig) return;
    const normalizedPath = normalizeLocalWorkspacePath(workspacePath, 'ClaudeTrustService');
    if (!normalizedPath) return;
    const configPath = path.join(homedir, trustConfig.configName);
    await this.withLock(configPath, () =>
      this.ensureTrusted(normalizedPath, {
        readConfig: () => readLocalConfig(configPath),
        writeConfig: (content) => writeLocalConfigAtomic(configPath, content),
        trustConfig,
      })
    );
  }

  async maybeAutoTrustSsh({
    providerId,
    workspacePath,
    ctx,
    files,
    force = false,
  }: WorkspaceTrustSshArgs): Promise<void> {
    const trustConfig = await this.getTrustConfig(providerId, force);
    if (!trustConfig) return;

    const normalizedPath = await normalizeSshWorkspacePath(
      files,
      workspacePath,
      'ClaudeTrustService'
    );
    if (!normalizedPath) return;
    const homeDir = await resolveRemoteHome(ctx);
    const homeFs = files.fileSystem();
    if (!homeFs.success) {
      log.warn('ClaudeTrustService: failed to open filesystem for auto-trust', {
        path: normalizedPath,
        error: homeFs.error.message,
      });
      return;
    }
    const configPath = path.posix.join(homeDir, trustConfig.configName);

    await this.withLock(configPath, () =>
      this.ensureTrusted(normalizedPath, {
        readConfig: () => readRemoteConfig(homeFs.data, configPath),
        writeConfig: (content) => writeRemoteConfigAtomic(homeFs.data, ctx, configPath, content),
        trustConfig,
      })
    );
  }

  private async getTrustConfig(
    providerId: AgentProviderId,
    force: boolean
  ): Promise<TrustConfig | null> {
    if (providerId !== CLAUDE_PROVIDER_ID && providerId !== COPILOT_PROVIDER_ID) return null;
    if (!force) {
      const { autoTrustWorktrees } = await this.deps.getTaskSettings();
      if (!autoTrustWorktrees) return null;
    }

    if (providerId === COPILOT_PROVIDER_ID) {
      return {
        configName: COPILOT_CONFIG_NAME,
        parseWarningName: 'Copilot',
        withTrustedPath: withCopilotTrustedFolder,
      };
    }

    return {
      configName: CLAUDE_CONFIG_NAME,
      parseWarningName: 'Claude',
      withTrustedPath: withClaudeTrustedProject,
    };
  }

  private withLock(configPath: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.configLocks.get(configPath) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.configLocks.set(configPath, next);
    return next;
  }

  private async ensureTrusted(
    normalizedPath: string,
    io: {
      readConfig: () => Promise<TrustIoResult<string | null>>;
      writeConfig: (content: string) => Promise<TrustIoResult<void>>;
      trustConfig: TrustConfig;
    }
  ): Promise<void> {
    try {
      const rawConfig = await io.readConfig();
      if (!rawConfig.success) {
        log.warn('ClaudeTrustService: failed to read auto-trust config', {
          path: normalizedPath,
          error: rawConfig.error.message,
        });
        return;
      }
      const config = parseConfig(rawConfig.data, io.trustConfig.parseWarningName);
      if (!config) return;
      const nextConfig = io.trustConfig.withTrustedPath(config, normalizedPath);
      if (!nextConfig) return;
      const written = await io.writeConfig(JSON.stringify(nextConfig, null, 2) + '\n');
      if (!written.success) {
        log.warn('ClaudeTrustService: failed to write auto-trust config', {
          path: normalizedPath,
          error: written.error.message,
        });
      }
    } catch (error: unknown) {
      log.warn('ClaudeTrustService: failed to auto-trust worktree', {
        path: normalizedPath,
        error: String(error),
      });
    }
  }
}

export const claudeTrustService = new ClaudeTrustService({
  getTaskSettings: () => appSettingsService.get('tasks'),
});

type TrustConfig = {
  configName: string;
  parseWarningName: string;
  withTrustedPath: (
    config: Record<string, unknown>,
    worktreePath: string
  ) => Record<string, unknown> | null;
};

type TrustIoError = { message: string };
type TrustIoResult<T> = Result<T, TrustIoError>;

function parseConfig(raw: string | null, warningName: string): Record<string, unknown> | null {
  if (!raw || raw.trim() === '') return {};

  try {
    const parsed = JSON.parse(raw);
    if (isPlainObject(parsed)) return parsed;
    log.warn(`ClaudeTrustService: refusing to overwrite non-object ${warningName} config root`);
    return null;
  } catch (error: unknown) {
    log.warn(`ClaudeTrustService: refusing to overwrite corrupt ${warningName} config`, {
      error: String(error),
    });
    return null;
  }
}

function withClaudeTrustedProject(
  config: Record<string, unknown>,
  worktreePath: string
): Record<string, unknown> | null {
  const projects = isPlainObject(config.projects) ? config.projects : {};
  const existing = isPlainObject(projects[worktreePath]) ? projects[worktreePath] : {};

  const alreadyTrusted =
    existing['hasTrustDialogAccepted'] === true &&
    existing['hasCompletedProjectOnboarding'] === true;
  if (alreadyTrusted) return null;

  return {
    ...config,
    projects: {
      ...projects,
      [worktreePath]: {
        ...existing,
        hasTrustDialogAccepted: true,
        hasCompletedProjectOnboarding: true,
      },
    },
  };
}

function withCopilotTrustedFolder(
  config: Record<string, unknown>,
  worktreePath: string
): Record<string, unknown> | null {
  const trustedFolders = Array.isArray(config.trustedFolders) ? config.trustedFolders : [];
  if (trustedFolders.includes(worktreePath)) return null;

  return {
    ...config,
    trustedFolders: [...trustedFolders, worktreePath],
  };
}

async function readLocalConfig(configPath: string): Promise<TrustIoResult<string | null>> {
  try {
    return ok(await fs.readFile(configPath, 'utf8'));
  } catch (error: unknown) {
    if (isFileNotFoundException(error)) return ok(null);
    return err({ message: errorMessage(error) });
  }
}

async function writeLocalConfigAtomic(
  configPath: string,
  content: string
): Promise<TrustIoResult<void>> {
  const tmpPath = `${configPath}.${randomUUID()}.tmp`;
  try {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(tmpPath, content, 'utf8');
    await fs.rename(tmpPath, configPath);
    return ok();
  } catch (error: unknown) {
    try {
      await fs.rm(tmpPath, { force: true });
    } catch {}
    return err({ message: errorMessage(error) });
  }
}

async function readRemoteConfig(
  remoteFs: Pick<IFileSystem, 'readText'>,
  configPath: string
): Promise<TrustIoResult<string | null>> {
  const result = await remoteFs.readText(configPath, { maxBytes: CLAUDE_CONFIG_MAX_BYTES });
  if (result.success) return ok(result.data.content);
  if (isFileNotFoundError(result.error)) return ok(null);
  return err(result.error);
}

async function writeRemoteConfigAtomic(
  remoteFs: Pick<IFileSystem, 'writeText'>,
  ctx: IExecutionContext,
  configPath: string,
  content: string
): Promise<TrustIoResult<void>> {
  const tmpPath = `${configPath}.${randomUUID()}.tmp`;
  try {
    await ctx.exec('mkdir', ['-p', path.posix.dirname(configPath)]);
    const written = await remoteFs.writeText(tmpPath, content);
    if (!written.success) return err(written.error);
    await ctx.exec('mv', [tmpPath, configPath]);
    return ok();
  } catch (error: unknown) {
    try {
      await ctx.exec('rm', ['-f', tmpPath]);
    } catch {}
    return err({ message: errorMessage(error) });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
