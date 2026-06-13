import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { FileSystemProvider } from '@main/core/fs/types';
import { appSettingsService } from '@main/core/settings/settings-service';
import { log } from '@main/lib/logger';
import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import {
  ensureLocalJsonWorkspaceTrust,
  ensureSshJsonWorkspaceTrust,
  type JsonTrustConfig,
} from './json-workspace-trust-config';

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

    await ensureLocalJsonWorkspaceTrust({
      cwd,
      homedir,
      trustConfig: piTrustConfig,
      locks: this.configLocks,
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

    await ensureSshJsonWorkspaceTrust({
      cwd,
      ctx,
      remoteFs,
      trustConfig: piTrustConfig,
      locks: this.configLocks,
    });
  }

  private async shouldAutoTrust(providerId: AgentProviderId, force: boolean): Promise<boolean> {
    if (providerId !== PI_PROVIDER_ID) return false;
    if (force) return true;
    const { autoTrustWorktrees } = await this.deps.getTaskSettings();
    return autoTrustWorktrees;
  }
}

export const piTrustService = new PiTrustService({
  getTaskSettings: () => appSettingsService.get('tasks'),
});

type PiTrustConfig = Record<string, boolean | null>;

const piTrustConfig: JsonTrustConfig<PiTrustConfig> = {
  configName: PI_TRUST_CONFIG_NAME,
  maxBytes: PI_TRUST_CONFIG_MAX_BYTES,
  serviceName: 'PiTrustService',
  parseConfig: parseTrustConfig,
  withTrustedPath: withPiTrustedPath,
  localPath: canonicalizeLocalPath,
  useFileLock: true,
};

async function canonicalizeLocalPath(cwd: string): Promise<string> {
  return fs.realpath(cwd).catch(() => path.resolve(cwd));
}

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

function withPiTrustedPath(config: PiTrustConfig, worktreePath: string): PiTrustConfig | null {
  if (nearestTrustDecision(config, worktreePath) !== null) return null;

  return sortTrustConfig({
    ...config,
    [worktreePath]: true,
  });
}

function nearestTrustDecision(config: PiTrustConfig, worktreePath: string): boolean | null {
  let current = worktreePath;
  while (true) {
    const decision = config[current];
    if (decision === true || decision === false) return decision;

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function sortTrustConfig(config: PiTrustConfig): PiTrustConfig {
  const sorted: PiTrustConfig = {};
  for (const key of Object.keys(config).sort()) {
    sorted[key] = config[key] ?? null;
  }
  return sorted;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
