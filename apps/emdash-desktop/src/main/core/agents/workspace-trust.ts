import type { ITrustBehavior } from '@emdash/core/agents/plugins';
import type { AgentProviderId } from '@emdash/plugins/agents';
import { appSettingsService } from '@main/core/settings/settings-service';
import { log } from '@main/lib/logger';
import { getPlugin } from './plugin-registry';
import { resolveTrustTarget, type WorkspaceTrustHost } from './workspace-trust-target';

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
