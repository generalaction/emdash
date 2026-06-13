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
import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';

const PI_PROVIDER_ID: AgentProviderId = 'pi';
const PI_TRUST_CONFIG_NAME = '.pi/agent/trust.json';
const PI_TRUST_CONFIG_MAX_BYTES = 2 * 1024 * 1024;

export class PiTrustService {
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
    if (!(await this.shouldAutoTrust(providerId, force))) return;

    const normalizedPath = await fs.realpath(cwd).catch(() => path.resolve(cwd));
    const configPath = path.join(homedir, PI_TRUST_CONFIG_NAME);
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

    const normalizedPath = await remoteFs.realPath(cwd).catch(() => path.posix.resolve('/', cwd));
    const homeDir = await resolveRemoteHome(ctx);
    const configPath = path.posix.join(homeDir, PI_TRUST_CONFIG_NAME);

    await this.withLock(configPath, () =>
      this.ensureTrusted(normalizedPath, {
        readConfig: () => readRemoteConfig(remoteFs, configPath),
        writeConfig: (content) => writeRemoteConfigAtomic(remoteFs, ctx, configPath, content),
      })
    );
  }

  private async shouldAutoTrust(providerId: AgentProviderId, force: boolean): Promise<boolean> {
    if (providerId !== PI_PROVIDER_ID) return false;
    if (force) return true;
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
      const config = parseTrustConfig(rawConfig);
      if (!config) return;
      if (config[normalizedPath] === true) return;

      const nextConfig = {
        ...config,
        [normalizedPath]: true,
      };
      await io.writeConfig(JSON.stringify(sortTrustConfig(nextConfig), null, 2) + '\n');
    } catch (error: unknown) {
      log.warn('PiTrustService: failed to auto-trust worktree', {
        path: normalizedPath,
        error: String(error),
      });
    }
  }
}

export const piTrustService = new PiTrustService({
  getTaskSettings: () => appSettingsService.get('tasks'),
});

type PiTrustConfig = Record<string, boolean | null>;

function parseTrustConfig(raw: string | null): PiTrustConfig | null {
  if (!raw || raw.trim() === '') return {};

  try {
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) {
      log.warn('PiTrustService: refusing to overwrite non-object Pi trust config root');
      return null;
    }

    const config: PiTrustConfig = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value !== true && value !== false && value !== null) {
        log.warn('PiTrustService: refusing to overwrite invalid Pi trust config value', { key });
        return null;
      }
      config[key] = value;
    }
    return config;
  } catch (error: unknown) {
    log.warn('PiTrustService: refusing to overwrite corrupt Pi trust config', {
      error: String(error),
    });
    return null;
  }
}

function sortTrustConfig(config: PiTrustConfig): PiTrustConfig {
  const sorted: PiTrustConfig = {};
  for (const key of Object.keys(config).sort()) {
    sorted[key] = config[key] ?? null;
  }
  return sorted;
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
    const result = await remoteFs.read(configPath, PI_TRUST_CONFIG_MAX_BYTES);
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
