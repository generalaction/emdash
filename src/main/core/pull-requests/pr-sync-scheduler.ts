import { eq } from 'drizzle-orm';
import { gitWatcherRegistry } from '@main/core/git/git-watcher-registry';
import { githubRepositoryResolver } from '@main/core/github/services/github-repository-resolver';
import {
  resolveProjectGitHubAuthContext,
  type ProjectGitHubAuthContextError,
} from '@main/core/github/services/project-github-auth-context';
import { projectManager } from '@main/core/projects/project-manager';
import { projectSettingsService } from '@main/core/projects/settings/project-settings-service';
import { taskSessionManager } from '@main/core/tasks/task-session-manager';
import { db } from '@main/db/client';
import { projectRemotes } from '@main/db/schema';
import { events } from '@main/lib/events';
import type { IDisposable, IInitializable } from '@main/lib/lifecycle';
import { log } from '@main/lib/logger';
import { prSyncProgressChannel } from '@shared/core/pull-requests/prEvents';
import { parseRepositoryRef } from '@shared/repository-ref';
import { prSyncEngine } from './pr-sync-engine';
import { syncProjectRemotes } from './project-remotes-service';

const INCREMENTAL_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Wires sync coordinator to application lifecycle events.
 * Called from project providers at mount, unmount, provision, and config change.
 */
export class PrSyncScheduler implements IInitializable, IDisposable {
  /** Per-project set of interval handles for light sync polling. */
  private readonly _intervals = new Map<string, ReturnType<typeof setInterval>[]>();
  /** Per-project set of known GitHub remote URLs (for cleanup on unmount). */
  private readonly _projectRemoteUrls = new Map<string, string[]>();
  private _unsubscribes: Array<() => void> = [];

  initialize(): void {
    this._unsubscribes = [
      projectManager.on('projectOpened', (id) => this.onProjectMounted(id)),
      projectManager.on('projectClosed', (id) => this.onProjectUnmounted(id)),
      taskSessionManager.hooks.on('task:provisioned', ({ projectId, branchName }) => {
        void this.onTaskProvisioned(projectId, branchName);
      }),
      gitWatcherRegistry.on('ref:changed', (p) => {
        if (p.kind === 'config') void this.onRemoteChanged(p.projectId);
      }),
      projectSettingsService.on('project-settings:changed', ({ projectId }) => {
        void this.onProjectSettingsChanged(projectId);
      }),
    ];
  }

  dispose(): void {
    for (const unsub of this._unsubscribes) unsub();
    this._unsubscribes = [];
  }

  async onProjectMounted(projectId: string): Promise<void> {
    log.info('PrSyncScheduler: onProjectMounted', { projectId });
    const remoteUrls = await this._syncAndGetGitHubRemotes(projectId);
    if (remoteUrls.length === 0) {
      log.info('PrSyncScheduler: no GitHub remotes found, skipping sync', { projectId });
      return;
    }

    log.info('PrSyncScheduler: found GitHub remotes', { projectId, remoteUrls });
    this._projectRemoteUrls.set(projectId, remoteUrls);
    await this._startSyncIntervals(projectId, remoteUrls);
  }

  onProjectUnmounted(projectId: string): void {
    const handles = this._intervals.get(projectId) ?? [];
    log.info('PrSyncScheduler: onProjectUnmounted, clearing intervals and cancelling syncs', {
      projectId,
      intervals: handles.length,
    });
    for (const h of handles) clearInterval(h);
    this._intervals.delete(projectId);

    // Cancel in-flight syncs for all remotes of this project
    const remoteUrls = this._projectRemoteUrls.get(projectId) ?? [];
    for (const url of remoteUrls) {
      prSyncEngine.cancel(url);
    }
    this._projectRemoteUrls.delete(projectId);
  }

  // ── Task lifecycle ─────────────────────────────────────────────────────────

  async onTaskProvisioned(projectId: string, taskBranch: string | undefined): Promise<void> {
    if (!taskBranch) return;

    const remoteUrls = await this._getGitHubRemoteUrls(projectId);
    for (const url of remoteUrls) {
      const prNumber = await this._findPrNumberForBranch(url, taskBranch);
      if (prNumber !== null) {
        void this._syncSingle(projectId, url, prNumber);
      }
    }
  }

  // ── Remote config change ───────────────────────────────────────────────────

  async onRemoteChanged(projectId: string): Promise<void> {
    const oldUrls = new Set(this._projectRemoteUrls.get(projectId) ?? []);

    // Re-sync project_remotes table and get new set
    const newUrls = await this._syncAndGetGitHubRemotes(projectId);
    const newSet = new Set(newUrls);

    // Cancel syncs for removed remotes
    for (const url of oldUrls) {
      if (!newSet.has(url)) {
        prSyncEngine.cancel(url);
      }
    }

    this._projectRemoteUrls.set(projectId, newUrls);
    await this._restartSyncIntervals(projectId, newUrls);
  }

  async onProjectSettingsChanged(projectId: string): Promise<void> {
    const remoteUrls =
      this._projectRemoteUrls.get(projectId) ?? (await this._getGitHubRemoteUrls(projectId));
    if (remoteUrls.length === 0) return;

    this._projectRemoteUrls.set(projectId, remoteUrls);
    this._cancelSyncs(remoteUrls);
    await this._syncRemotes(projectId, remoteUrls);
  }

  private async _restartSyncIntervals(projectId: string, remoteUrls: string[]): Promise<void> {
    this._clearIntervals(projectId);
    this._cancelSyncs(remoteUrls);
    await this._startSyncIntervals(projectId, remoteUrls);
  }

  private async _startSyncIntervals(projectId: string, remoteUrls: string[]): Promise<void> {
    this._clearIntervals(projectId);
    const intervals: ReturnType<typeof setInterval>[] = [];

    await this._syncRemotes(projectId, remoteUrls);

    for (const url of remoteUrls) {
      const handle = setInterval(() => {
        void this._syncRemote(projectId, url);
      }, INCREMENTAL_SYNC_INTERVAL_MS);

      intervals.push(handle);
    }

    this._intervals.set(projectId, intervals);
  }

  private _cancelSyncs(remoteUrls: string[]): void {
    for (const url of remoteUrls) {
      prSyncEngine.cancel(url);
    }
  }

  private _clearIntervals(projectId: string): void {
    const handles = this._intervals.get(projectId) ?? [];
    for (const h of handles) clearInterval(h);
    this._intervals.delete(projectId);
  }

  private async _resolveAuthContext(
    projectId: string,
    remoteUrl: string,
    kind: 'incremental' | 'single' = 'incremental'
  ) {
    const authContext = await resolveProjectGitHubAuthContext(projectId);
    if (authContext.success) return authContext.data;

    log.warn('PrSyncScheduler: failed to resolve project GitHub account context', {
      projectId,
      error: authContext.error.message,
    });
    this._emitAuthResolutionError(remoteUrl, kind, authContext.error);
    return null;
  }

  private async _syncRemote(projectId: string, remoteUrl: string): Promise<void> {
    const authContext = await this._resolveAuthContext(projectId, remoteUrl);
    if (!authContext) return;
    // sync() routes to full or incremental based on cursor state.
    prSyncEngine.sync(remoteUrl, authContext);
  }

  private async _syncRemotes(projectId: string, remoteUrls: string[]): Promise<void> {
    for (const url of remoteUrls) {
      await this._syncRemote(projectId, url);
    }
  }

  private async _syncSingle(projectId: string, remoteUrl: string, prNumber: number): Promise<void> {
    const authContext = await this._resolveAuthContext(projectId, remoteUrl, 'single');
    if (!authContext) return;
    void prSyncEngine.syncSingle(remoteUrl, prNumber, authContext);
  }

  private _emitAuthResolutionError(
    remoteUrl: string,
    kind: 'incremental' | 'single',
    error: ProjectGitHubAuthContextError
  ): void {
    if (error.type !== 'unconfigured') return;
    events.emit(prSyncProgressChannel, {
      remoteUrl,
      kind,
      status: 'error',
      error: error.message,
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async _syncAndGetGitHubRemotes(projectId: string): Promise<string[]> {
    const project = projectManager.getProject(projectId);
    if (!project) return [];

    try {
      const remotes = await project.repository.getRemotes();
      await syncProjectRemotes(projectId, remotes);
      const resolved = await Promise.all(
        remotes.map((r) => githubRepositoryResolver.resolve(r.url))
      );
      return resolved.flatMap((repository) =>
        repository.success ? [repository.data.repositoryUrl] : []
      );
    } catch (e) {
      log.warn('PrSyncScheduler: failed to sync project remotes', { projectId, error: String(e) });
      return [];
    }
  }

  private async _getGitHubRemoteUrls(projectId: string): Promise<string[]> {
    const cached = this._projectRemoteUrls.get(projectId);
    if (cached) return cached;

    const rows = await db
      .select({ remoteUrl: projectRemotes.remoteUrl })
      .from(projectRemotes)
      .where(eq(projectRemotes.projectId, projectId));

    return rows.flatMap((r) => {
      const repository = parseRepositoryRef(r.remoteUrl);
      return repository ? [repository.repositoryUrl] : [];
    });
  }

  private async _findPrNumberForBranch(
    repositoryUrl: string,
    taskBranch: string
  ): Promise<number | null> {
    const { pullRequests } = await import('@main/db/schema');
    const { and, eq: deq } = await import('drizzle-orm');
    const rows = await db
      .select({ identifier: pullRequests.identifier })
      .from(pullRequests)
      .where(
        and(
          deq(pullRequests.repositoryUrl, repositoryUrl),
          deq(pullRequests.headRefName, taskBranch)
        )
      )
      .limit(1);

    if (!rows[0]?.identifier) return null;
    const n = Number.parseInt(rows[0].identifier.replace('#', ''), 10);
    return Number.isNaN(n) ? null : n;
  }
}

export const prSyncScheduler = new PrSyncScheduler();
