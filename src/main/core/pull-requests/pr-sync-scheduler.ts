import { and, eq, inArray } from 'drizzle-orm';
import { gitWatcherRegistry } from '@main/core/git/git-watcher-registry';
import { isGitHubUrl, normalizeGitHubUrl } from '@main/core/github/services/utils';
import { projectManager } from '@main/core/projects/project-manager';
import { taskManager } from '@main/core/tasks/task-manager';
import { db } from '@main/db/client';
import { projectRemotes, pullRequests } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { prSyncEngine } from './pr-sync-engine';
import { syncProjectRemotes } from './project-remotes-service';

const INCREMENTAL_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Wires sync coordinator to application lifecycle events.
 * Called from project providers at mount, unmount, provision, and config change.
 */
export class PrSyncScheduler {
  /** Per-project set of interval handles for light sync polling. */
  private readonly _intervals = new Map<string, ReturnType<typeof setInterval>[]>();
  /** Per-project set of known GitHub remote URLs (for cleanup on unmount). */
  private readonly _projectRemoteUrls = new Map<string, string[]>();
  private _unsubscribes: Array<() => void> = [];

  initialize(): void {
    this._unsubscribes = [
      projectManager.on('projectOpened', (id) => this.onProjectMounted(id)),
      projectManager.on('projectClosed', (id) => this.onProjectUnmounted(id)),
      taskManager.hooks.on('task:provisioned', ({ projectId, taskBranch }) => {
        void this.onTaskProvisioned(projectId, taskBranch);
      }),
      gitWatcherRegistry.on('ref:changed', (p) => {
        if (p.kind === 'config') void this.onRemoteChanged(p.projectId);
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
    const intervals: ReturnType<typeof setInterval>[] = [];

    for (const url of remoteUrls) {
      // sync() routes to full or incremental based on cursor state
      prSyncEngine.sync(url);

      const handle = setInterval(() => {
        prSyncEngine.sync(url);
      }, INCREMENTAL_SYNC_INTERVAL_MS);

      intervals.push(handle);
    }

    this._intervals.set(projectId, intervals);
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

    const projectRemoteUrls = await this._getStoredGitHubRemoteUrls(projectId);
    if (projectRemoteUrls.length === 0) return;

    const allRepositoryUrls = await this._expandWithForkParents(projectRemoteUrls);

    const rows = await db
      .select({
        identifier: pullRequests.identifier,
        repositoryUrl: pullRequests.repositoryUrl,
      })
      .from(pullRequests)
      .where(
        and(
          eq(pullRequests.headRefName, taskBranch),
          inArray(pullRequests.repositoryUrl, allRepositoryUrls),
          inArray(pullRequests.headRepositoryUrl, projectRemoteUrls)
        )
      );

    for (const row of rows) {
      const prNumber = parsePrNumber(row.identifier);
      if (prNumber !== null) {
        void prSyncEngine.syncSingle(row.repositoryUrl, prNumber);
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

    // Clear old intervals for this project
    const handles = this._intervals.get(projectId) ?? [];
    for (const h of handles) clearInterval(h);

    this._projectRemoteUrls.set(projectId, newUrls);
    const intervals: ReturnType<typeof setInterval>[] = [];

    for (const url of newUrls) {
      prSyncEngine.sync(url);

      const handle = setInterval(() => {
        prSyncEngine.sync(url);
      }, INCREMENTAL_SYNC_INTERVAL_MS);

      intervals.push(handle);
    }

    this._intervals.set(projectId, intervals);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async _syncAndGetGitHubRemotes(projectId: string): Promise<string[]> {
    const project = projectManager.getProject(projectId);
    if (!project) return [];

    try {
      const remotes = await project.repository.getRemotes();
      await syncProjectRemotes(projectId, remotes);
      const githubUrls = remotes
        .filter((r) => isGitHubUrl(r.url))
        .map((r) => normalizeGitHubUrl(r.url));
      return this._expandWithForkParents(githubUrls);
    } catch (e) {
      log.warn('PrSyncScheduler: failed to sync project remotes', { projectId, error: String(e) });
      return [];
    }
  }

  private async _getStoredGitHubRemoteUrls(projectId: string): Promise<string[]> {
    const rows = await db
      .select({ remoteUrl: projectRemotes.remoteUrl })
      .from(projectRemotes)
      .where(eq(projectRemotes.projectId, projectId));

    return rows.filter((r) => isGitHubUrl(r.remoteUrl)).map((r) => normalizeGitHubUrl(r.remoteUrl));
  }

  private async _expandWithForkParents(repositoryUrls: string[]): Promise<string[]> {
    const expanded = await Promise.all(
      repositoryUrls.map((url) => prSyncEngine.getRelatedRepositoryUrls(url))
    );
    return [...new Set(expanded.flat())];
  }
}

function parsePrNumber(identifier: string | null): number | null {
  if (!identifier) return null;
  const n = parseInt(identifier.replace('#', ''), 10);
  return Number.isNaN(n) ? null : n;
}

export const prSyncScheduler = new PrSyncScheduler();
