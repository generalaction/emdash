import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import {
  FileSystemError,
  FileSystemErrorCodes,
  type FileSystemProvider,
} from '@main/core/fs/types';
import { appSettingsService } from '@main/core/settings/settings-service';
import { resolveRemoteHome } from '@main/core/ssh/utils';
import type { ExecFn } from '@main/core/utils/exec';
import { log } from '@main/lib/logger';

const CLAUDE_PROVIDER_ID: AgentProviderId = 'claude';
const CLAUDE_CONFIG_NAME = '.claude.json';
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
  }: {
    providerId: AgentProviderId;
    cwd?: string;
    homedir: string;
  }): Promise<void> {
    if (!cwd) return;
    if (!(await this.shouldAutoTrust(providerId))) return;
    const normalizedPath = path.resolve(cwd);
    const configPath = path.join(homedir, CLAUDE_CONFIG_NAME);
    await this.withLock(configPath, () =>
      this.ensureTrusted(normalizedPath, {
        readConfig: () => readLocalConfig(configPath),
        writeConfig: (content) => writeLocalConfigAtomic(configPath, content),
      })
    );
  }

  async maybeAutoTrustSsh({
    providerId,
    cwd,
    exec,
    remoteFs,
  }: {
    providerId: AgentProviderId;
    cwd?: string;
    exec: ExecFn;
    remoteFs: Pick<FileSystemProvider, 'realPath' | 'read' | 'write'>;
  }): Promise<void> {
    if (!cwd) return;
    if (!(await this.shouldAutoTrust(providerId))) return;

    const normalizedPath = await remoteFs.realPath(cwd).catch(() => path.posix.resolve('/', cwd));
    const homeDir = await resolveRemoteHome(exec);
    const configPath = path.posix.join(homeDir, CLAUDE_CONFIG_NAME);

    await this.withLock(configPath, () =>
      this.ensureTrusted(normalizedPath, {
        readConfig: () => readRemoteConfig(remoteFs, configPath),
        writeConfig: (content) => writeRemoteConfigAtomic(remoteFs, exec, configPath, content),
      })
    );
  }

  private async shouldAutoTrust(providerId: AgentProviderId): Promise<boolean> {
    if (providerId !== CLAUDE_PROVIDER_ID) return false;
    const { autoTrustWorktrees } = await this.deps.getTaskSettings();
    return autoTrustWorktrees;
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
    }
  ): Promise<void> {
    try {
      const rawConfig = await io.readConfig();
      const config = parseConfig(rawConfig);
      if (!config) return;
      const nextConfig = withTrustedProject(config, normalizedPath);
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

function parseConfig(raw: string | null): Record<string, unknown> | null {
  if (!raw || raw.trim() === '') return {};

  try {
    const parsed = JSON.parse(raw);
    if (isPlainObject(parsed)) return parsed;
    log.warn('ClaudeTrustService: refusing to overwrite non-object Claude config root');
    return null;
  } catch (error: unknown) {
    log.warn('ClaudeTrustService: refusing to overwrite corrupt Claude config', {
      error: String(error),
    });
    return null;
  }
}

function withTrustedProject(
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
  exec: ExecFn,
  configPath: string,
  content: string
): Promise<void> {
  const tmpPath = `${configPath}.${randomUUID()}.tmp`;
  try {
    await remoteFs.write(tmpPath, content);
    await exec('mv', [tmpPath, configPath]);
  } catch (error: unknown) {
    try {
      await exec('rm', ['-f', tmpPath]);
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
