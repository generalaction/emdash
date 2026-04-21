import { eq } from 'drizzle-orm';
import { isGitHubUrl, normalizeGitHubUrl } from '@main/core/github/services/utils';
import { projectManager } from '@main/core/projects/project-manager';
import { db } from '@main/db/client';
import { projectRemotes } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { prSyncEngine } from './pr-service';
import { prSyncCoordinator } from './pr-sync-coordinator';
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

  // ── Project lifecycle ──────────────────────────────────────────────────────

  async onProjectMounted(projectId: string): Promise<void> {
    const remoteUrls = await this._syncAndGetGitHubRemotes(projectId);
    if (remoteUrls.length === 0) return;

    this._projectRemoteUrls.set(projectId, remoteUrls);
    const intervals: ReturnType<typeof setInterval>[] = [];

    for (const url of remoteUrls) {
      const cursor = await prSyncEngine.getFullSyncCursor(url);

      if (!cursor?.done) {
        // Full sync not yet complete — start (or resume) it
        prSyncCoordinator.runFullSync(url);
      } else {
        // Full sync done — run an incremental sync immediately, then schedule recurring
        prSyncCoordinator.runIncrementalSync(url);
      }

      // Always schedule the recurring incremental sync — the engine guards against
      // running it before full sync is done
      const handle = setInterval(() => {
        prSyncCoordinator.runIncrementalSync(url);
      }, INCREMENTAL_SYNC_INTERVAL_MS);

      intervals.push(handle);
    }

    this._intervals.set(projectId, intervals);
  }

  onProjectUnmounted(projectId: string): void {
    // Clear polling intervals
    const handles = this._intervals.get(projectId) ?? [];
    for (const h of handles) clearInterval(h);
    this._intervals.delete(projectId);

    // Cancel in-flight syncs for all remotes of this project
    const remoteUrls = this._projectRemoteUrls.get(projectId) ?? [];
    for (const url of remoteUrls) {
      prSyncCoordinator.cancelAll(url);
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
        void prSyncCoordinator.syncSingle(url, prNumber);
      }
    }
  }

  async onPushCompleted(projectId: string, taskBranch: string): Promise<void> {
    return this.onTaskProvisioned(projectId, taskBranch);
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
        prSyncCoordinator.cancelAll(url);
      }
    }

    // Clear old intervals for this project
    const handles = this._intervals.get(projectId) ?? [];
    for (const h of handles) clearInterval(h);

    this._projectRemoteUrls.set(projectId, newUrls);
    const intervals: ReturnType<typeof setInterval>[] = [];

    // Trigger full sync for newly added remotes, light sync for existing ones
    for (const url of newUrls) {
      if (!oldUrls.has(url)) {
        prSyncCoordinator.runFullSync(url);
      } else {
        prSyncCoordinator.runIncrementalSync(url);
      }

      const handle = setInterval(() => {
        prSyncCoordinator.runIncrementalSync(url);
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
      return remotes.filter((r) => isGitHubUrl(r.url)).map((r) => normalizeGitHubUrl(r.url));
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

    return rows.filter((r) => isGitHubUrl(r.remoteUrl)).map((r) => normalizeGitHubUrl(r.remoteUrl));
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
    const n = parseInt(rows[0].identifier.replace('#', ''), 10);
    return isNaN(n) ? null : n;
  }
}

export const prSyncScheduler = new PrSyncScheduler();
