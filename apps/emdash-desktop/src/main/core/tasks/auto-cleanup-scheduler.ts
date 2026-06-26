import { and, desc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { appSettingsService } from '@main/core/settings/settings-service';
import { archiveTask } from '@main/core/tasks/operations/archiveTask';
import { deleteTask } from '@main/core/tasks/operations/deleteTask';
import { db } from '@main/db/client';
import { projectRemotes, pullRequests, tasks, workspaces } from '@main/db/schema';
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
  private _running = false;

  initialize(): void {
    if (this._interval) return;
    // First tick on the next microtask so initialization order is unaffected.
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
    if (this._running) return;
    this._running = true;
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
    } finally {
      this._running = false;
    }
  }

  private async _loadCandidates(cutoffIso: string): Promise<Candidate[]> {
    // The activity timestamp falls back to updated_at when the task has never been
    // interacted with (mirrors the sidebar's "lastInteractedAt ?? updatedAt").
    const lastActivity = sql<string>`COALESCE(${tasks.lastInteractedAt}, ${tasks.updatedAt})`;

    const rows = await db
      .select({
        taskId: tasks.id,
        projectId: tasks.projectId,
        prUrl: pullRequests.url,
        lastActivity,
      })
      .from(tasks)
      .innerJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
      .innerJoin(projectRemotes, eq(projectRemotes.projectId, tasks.projectId))
      .innerJoin(
        pullRequests,
        and(
          eq(pullRequests.headRefName, workspaces.branchName),
          or(
            eq(pullRequests.repositoryUrl, projectRemotes.remoteUrl),
            eq(pullRequests.headRepositoryUrl, projectRemotes.remoteUrl)
          )
        )
      )
      .where(
        and(
          isNull(tasks.archivedAt),
          eq(tasks.type, 'task'),
          eq(pullRequests.status, 'merged'),
          lte(lastActivity, cutoffIso)
        )
      )
      .orderBy(desc(lastActivity));

    // The join can yield duplicates per task: multiple PRs match the same branch,
    // or one PR matches multiple project remotes. Keep the first row per task.
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
