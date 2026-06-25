import { and, desc, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { appSettingsService } from '@main/core/settings/settings-service';
import { archiveTask } from '@main/core/tasks/operations/archiveTask';
import { deleteTask } from '@main/core/tasks/operations/deleteTask';
import { db } from '@main/db/client';
import { pullRequests, tasks, workspaces } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';

const AUTO_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes — matches pr-sync-scheduler

interface Candidate {
  taskId: string;
  projectId: string;
  prUrl: string;
}

export class AutoCleanupScheduler {
  private _interval: ReturnType<typeof setInterval> | null = null;

  initialize(): void {
    if (this._interval) return;
    // First tick on next macrotask so initialization order is unaffected.
    queueMicrotask(() => {
      void this.runOnce();
    });
    this._interval = setInterval(() => {
      void this.runOnce();
    }, AUTO_CLEANUP_INTERVAL_MS);
  }

  dispose(): void {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }

  async runOnce(): Promise<void> {
    try {
      const settings = await appSettingsService.get('tasks');
      if (!settings.autoCleanupMergedEnabled) return;

      const cutoffIso = new Date(Date.now() - settings.autoCleanupMergedDelayMs).toISOString();
      const candidates = await this._loadCandidates(cutoffIso);
      if (candidates.length === 0) return;

      for (const candidate of candidates) {
        try {
          await this._apply(candidate, settings);
          telemetryService.capture('task_auto_cleaned_up', {
            project_id: candidate.projectId,
            task_id: candidate.taskId,
            action: settings.autoCleanupMergedAction,
            delay_ms: settings.autoCleanupMergedDelayMs,
          });
        } catch (e: unknown) {
          log.warn('auto-cleanup: action failed', {
            taskId: candidate.taskId,
            error: String(e),
          });
        }
      }
    } catch (e: unknown) {
      log.warn('auto-cleanup: tick failed', { error: String(e) });
    }
  }

  private async _loadCandidates(cutoffIso: string): Promise<Candidate[]> {
    const rows = await db
      .select({
        taskId: tasks.id,
        projectId: tasks.projectId,
        prUrl: pullRequests.url,
        mergedAt: pullRequests.mergedAt,
      })
      .from(tasks)
      .innerJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
      .innerJoin(pullRequests, eq(pullRequests.headRefName, workspaces.branchName))
      .where(
        and(
          sql`${tasks.archivedAt} IS NULL`,
          eq(tasks.autoCleanupOptOut, false),
          eq(pullRequests.status, 'merged'),
          isNotNull(pullRequests.mergedAt),
          lte(pullRequests.mergedAt, cutoffIso)
        )
      )
      .orderBy(desc(pullRequests.mergedAt));

    // If multiple PRs match the same branch (e.g. a closed+reopened pair),
    // we may see the same task twice. Keep the most recent merge per task.
    const seen = new Set<string>();
    const out: Candidate[] = [];
    for (const row of rows) {
      if (seen.has(row.taskId)) continue;
      seen.add(row.taskId);
      out.push({
        taskId: row.taskId,
        projectId: row.projectId,
        prUrl: row.prUrl,
      });
    }
    return out;
  }

  private async _apply(
    candidate: Candidate,
    settings: {
      autoCleanupMergedAction: 'archive' | 'delete';
      autoCleanupMergedDeleteBranch: boolean;
    }
  ): Promise<void> {
    if (settings.autoCleanupMergedAction === 'archive') {
      await archiveTask(candidate.projectId, candidate.taskId);
    } else {
      await deleteTask(candidate.projectId, candidate.taskId, {
        deleteWorktree: true,
        deleteBranch: settings.autoCleanupMergedDeleteBranch,
      });
    }
  }
}

export const autoCleanupScheduler = new AutoCleanupScheduler();
