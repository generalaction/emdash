import path from 'node:path';
import type { ITrustBehavior, PluginFs } from '@emdash/core/agents/plugins';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { IFilesRuntime } from '@main/core/runtime/types';
import { appSettingsService } from '@main/core/settings/settings-service';
import { resolveRemoteHome } from '@main/core/ssh/lifecycle/remote-shell-profile';
import { log } from '@main/lib/logger';
import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import { createPluginFs } from './plugin-fs';
import { getPlugin } from './plugin-registry';
import { createRemotePluginFs } from './remote-plugin-fs';

export type WorkspaceTrustHost =
  | { kind: 'local'; homedir: string }
  | { kind: 'ssh'; ctx: IExecutionContext; files: IFilesRuntime };

export type WorkspaceTrustArgs = {
  providerId: AgentProviderId;
  workspacePath: string;
  host: WorkspaceTrustHost;
  force?: boolean;
};

type WorkspaceTrustDeps = {
  getTaskSettings: () => Promise<{ autoTrustWorktrees: boolean }>;
  getTrustBehavior: (providerId: AgentProviderId) => ITrustBehavior | undefined;
};

type TrustTarget = {
  fs: PluginFs;
  lockKey: string;
  workspacePath: string;
};

export class WorkspaceTrustService {
  private readonly homeLocks = new Map<string, Promise<void>>();

  constructor(private readonly deps: WorkspaceTrustDeps) {}

  /**
   * Mark the workspace as trusted in the provider's config so the agent CLI
   * skips its trust prompt. No-op unless the provider has a trust behavior
   * and auto-trust is enabled (or `force` is set, e.g. for auto-approve runs).
   */
  async maybeAutoTrust({
    providerId,
    workspacePath,
    host,
    force = false,
  }: WorkspaceTrustArgs): Promise<void> {
    const behavior = this.deps.getTrustBehavior(providerId);
    if (!behavior) return;
    if (!(await this.shouldAutoTrust(force))) return;

    const target = await resolveTrustTarget(host, workspacePath);
    if (!target) return;

    await this.withHomeLock(target.lockKey, async () => {
      try {
        await behavior.trustWorkspace(target.fs, { workspacePath: target.workspacePath });
      } catch (error: unknown) {
        log.warn('WorkspaceTrust: failed to auto-trust worktree', {
          providerId,
          path: target.workspacePath,
          error: String(error),
        });
      }
    });
  }

  private async shouldAutoTrust(force: boolean): Promise<boolean> {
    if (force) return true;
    const { autoTrustWorktrees } = await this.deps.getTaskSettings();
    return autoTrustWorktrees;
  }

  /**
   * Serialize trust writes per home directory: trust configs are shared
   * read-merge-write files, so concurrent writers would lose updates.
   */
  private withHomeLock(lockKey: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.homeLocks.get(lockKey) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.homeLocks.set(lockKey, next);
    return next;
  }
}

export const workspaceTrustService = new WorkspaceTrustService({
  getTaskSettings: () => appSettingsService.get('tasks'),
  getTrustBehavior: (providerId) => getPlugin(providerId).behavior.trust,
});

async function resolveTrustTarget(
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

  const normalizedPath = await normalizeSshWorkspacePath(host.files, workspacePath);
  if (!normalizedPath) return null;
  const homeDir = await resolveRemoteHome(host.ctx);
  return {
    fs: createRemotePluginFs(host.ctx, host.files, homeDir),
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

async function normalizeSshWorkspacePath(
  files: IFilesRuntime,
  workspacePath: string
): Promise<string | null> {
  if (!files.path.isAbsolute(workspacePath)) {
    log.warn('WorkspaceTrust: refusing to auto-trust non-absolute workspace path', {
      path: workspacePath,
    });
    return null;
  }

  const opened = files.fileSystem();
  if (!opened.success) {
    log.warn('WorkspaceTrust: failed to open filesystem for workspace trust', {
      path: workspacePath,
      error: opened.error.message,
    });
    return null;
  }

  const realPath = await opened.data.realPath(workspacePath);
  return realPath.success ? realPath.data : path.posix.normalize(workspacePath);
}
