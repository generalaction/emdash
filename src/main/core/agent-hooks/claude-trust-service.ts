import { randomUUID } from 'node:crypto';
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
import type { AgentProviderId } from '@shared/agent-provider-registry';

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
    const trustConfig = await this.getTrustConfig(providerId, force);
    if (!trustConfig) return;
    const normalizedPath = path.resolve(cwd);
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
    const trustConfig = await this.getTrustConfig(providerId, force);
    if (!trustConfig) return;

    const normalizedPath = await remoteFs.realPath(cwd).catch(() => path.posix.resolve('/', cwd));
    const homeDir = await resolveRemoteHome(ctx);
    const configPath = path.posix.join(homeDir, trustConfig.configName);

    await this.withLock(configPath, () =>
      this.ensureTrusted(normalizedPath, {
        readConfig: () => readRemoteConfig(remoteFs, configPath),
        writeConfig: (content) => writeRemoteConfigAtomic(remoteFs, ctx, configPath, content),
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
      readConfig: () => Promise<string | null>;
      writeConfig: (content: string) => Promise<void>;
      trustConfig: TrustConfig;
    }
  ): Promise<void> {
    try {
      const rawConfig = await io.readConfig();
      const config = parseConfig(rawConfig, io.trustConfig.parseWarningName);
      if (!config) return;
      const nextConfig = io.trustConfig.withTrustedPath(config, normalizedPath);
      if (!nextConfig) return;
      await io.writeConfig(JSON.stringify(nextConfig, null, 2) + '\n');
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

async function readLocalConfig(configPath: string): Promise<string | null> {
  try {
    return await fs.readFile(configPath, 'utf8');
  } catch (error: unknown) {
    if (isNodeNotFound(error)) return null;
    throw error;
  }
}

async function writeLocalConfigAtomic(configPath: string, content: string): Promise<void> {
  const tmpPath = `${configPath}.${randomUUID()}.tmp`;
  try {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(tmpPath, content, 'utf8');
    await fs.rename(tmpPath, configPath);
  } catch (error: unknown) {
    try {
      await fs.rm(tmpPath, { force: true });
    } catch {}
    throw error;
  }
}

async function readRemoteConfig(
  remoteFs: Pick<FileSystemProvider, 'read'>,
  configPath: string
): Promise<string | null> {
  try {
    const result = await remoteFs.read(configPath, CLAUDE_CONFIG_MAX_BYTES);
    return result.content;
  } catch (error: unknown) {
    if (isFsNotFound(error)) return null;
    throw error;
  }
}

async function writeRemoteConfigAtomic(
  remoteFs: Pick<FileSystemProvider, 'write'>,
  ctx: IExecutionContext,
  configPath: string,
  content: string
): Promise<void> {
  const tmpPath = `${configPath}.${randomUUID()}.tmp`;
  try {
    await ctx.exec('mkdir', ['-p', path.posix.dirname(configPath)]);
    await remoteFs.write(tmpPath, content);
    await ctx.exec('mv', [tmpPath, configPath]);
  } catch (error: unknown) {
    try {
      await ctx.exec('rm', ['-f', tmpPath]);
    } catch {}
    throw error;
  }
}

function isNodeNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

function isFsNotFound(error: unknown): boolean {
  return error instanceof FileSystemError && error.code === FileSystemErrorCodes.NOT_FOUND;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
