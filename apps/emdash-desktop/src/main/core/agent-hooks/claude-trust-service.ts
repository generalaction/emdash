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

const CLAUDE_PROVIDER_ID: AgentProviderId = 'claude';
const COPILOT_PROVIDER_ID: AgentProviderId = 'copilot';
const CLAUDE_CONFIG_NAME = '.claude.json';
const COPILOT_CONFIG_NAME = '.copilot/config.json';
const TRUST_CONFIG_MAX_BYTES = 2 * 1024 * 1024;

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

    await ensureLocalJsonWorkspaceTrust({
      cwd,
      homedir,
      trustConfig,
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
    const trustConfig = await this.getTrustConfig(providerId, force);
    if (!trustConfig) return;

    await ensureSshJsonWorkspaceTrust({
      cwd,
      ctx,
      remoteFs,
      trustConfig,
      locks: this.configLocks,
    });
  }

  private async getTrustConfig(
    providerId: AgentProviderId,
    force: boolean
  ): Promise<JsonTrustConfig<Record<string, unknown>> | null> {
    if (providerId !== CLAUDE_PROVIDER_ID && providerId !== COPILOT_PROVIDER_ID) return null;
    if (!force) {
      const { autoTrustWorktrees } = await this.deps.getTaskSettings();
      if (!autoTrustWorktrees) return null;
    }

    return providerId === COPILOT_PROVIDER_ID ? copilotTrustConfig : claudeTrustConfig;
  }
}

export const claudeTrustService = new ClaudeTrustService({
  getTaskSettings: () => appSettingsService.get('tasks'),
});

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

const claudeTrustConfig: JsonTrustConfig<Record<string, unknown>> = {
  configName: CLAUDE_CONFIG_NAME,
  maxBytes: TRUST_CONFIG_MAX_BYTES,
  serviceName: 'ClaudeTrustService',
  parseConfig: (raw) => parseConfig(raw, 'Claude'),
  withTrustedPath: withClaudeTrustedProject,
};

const copilotTrustConfig: JsonTrustConfig<Record<string, unknown>> = {
  configName: COPILOT_CONFIG_NAME,
  maxBytes: TRUST_CONFIG_MAX_BYTES,
  serviceName: 'ClaudeTrustService',
  parseConfig: (raw) => parseConfig(raw, 'Copilot'),
  withTrustedPath: withCopilotTrustedFolder,
};

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
