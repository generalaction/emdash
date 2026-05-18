import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { CoordinationStatus, FileOverlap, SiblingTask } from '@shared/coordination';
import { db } from '@main/db/client';
import { taskActivity, tasks, taskTouchedFiles } from '@main/db/schema';

/**
 * Status decay windows. After 5 min of silence a task is considered idle;
 * after 2 hours, inactive. The decay logic runs on a periodic timer in the
 * coordination service — these constants are exported so the timer can apply
 * the same thresholds we expose via queries.
 */
export const ACTIVE_TO_IDLE_MS = 5 * 60 * 1000;
export const IDLE_TO_INACTIVE_MS = 2 * 60 * 60 * 1000;

interface PendingTouch {
  taskId: string;
  paths: Set<string>;
}

/**
 * Read/write layer for the coordination tables.
 *
 * Touch writes are debounced (default 2s) and batched per task so a noisy
 * agent firing dozens of edit events doesn't translate to dozens of inserts.
 */
class ActivityStore {
  private readonly pending = new Map<string, PendingTouch>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly flushIntervalMs = 2000;

  /** Queue touches for the given task. Flushed in batch. */
  recordTouches(taskId: string, paths: string[]): void {
    if (paths.length === 0) return;
    const existing = this.pending.get(taskId);
    if (existing) {
      for (const p of paths) existing.paths.add(p);
    } else {
      this.pending.set(taskId, { taskId, paths: new Set(paths) });
    }
    this.scheduleFlush();
  }

  /** Mark the task active and stamp lastEventAt = now. Synchronous. */
  markActive(taskId: string, summary?: string | null): void {
    const now = new Date().toISOString();
    db.insert(taskActivity)
      .values({
        taskId,
        status: 'active',
        summary: summary ?? null,
        lastEventAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: taskActivity.taskId,
        set: {
          status: 'active',
          lastEventAt: now,
          updatedAt: now,
          ...(summary != null ? { summary } : {}),
        },
      })
      .run();
  }

  /** Flush pending touches immediately. Safe to call at any time. */
  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pending.size === 0) return;
    const now = new Date().toISOString();
    const batch = [...this.pending.values()];
    this.pending.clear();

    db.transaction((tx) => {
      for (const { taskId, paths } of batch) {
        for (const p of paths) {
          tx.insert(taskTouchedFiles)
            .values({ taskId, filePath: p, lastTouchedAt: now })
            .onConflictDoUpdate({
              target: [taskTouchedFiles.taskId, taskTouchedFiles.filePath],
              set: { lastTouchedAt: now },
            })
            .run();
        }
      }
    });
  }

  /**
   * Replace the touched-file set for a task with `paths`. Anything previously
   * recorded for the task that's not in `paths` is removed. Use this after a
   * full git scan; `recordTouches` is for incremental signals.
   */
  replaceTouches(taskId: string, paths: string[]): void {
    const now = new Date().toISOString();
    db.transaction((tx) => {
      tx.delete(taskTouchedFiles).where(eq(taskTouchedFiles.taskId, taskId)).run();
      if (paths.length === 0) return;
      // Insert in a single statement when possible.
      tx.insert(taskTouchedFiles)
        .values(paths.map((p) => ({ taskId, filePath: p, lastTouchedAt: now })))
        .run();
    });
  }

  /**
   * Apply status decay. Tasks active longer than ACTIVE_TO_IDLE_MS without an
   * event become idle; idle longer than IDLE_TO_INACTIVE_MS become inactive.
   * Returns nothing — callers fetch fresh state via the read methods.
   */
  applyStatusDecay(): void {
    const now = Date.now();
    const idleCutoff = new Date(now - ACTIVE_TO_IDLE_MS).toISOString();
    const inactiveCutoff = new Date(now - IDLE_TO_INACTIVE_MS).toISOString();
    db.update(taskActivity)
      .set({ status: 'idle', updatedAt: new Date().toISOString() })
      .where(
        and(eq(taskActivity.status, 'active'), sql`${taskActivity.lastEventAt} < ${idleCutoff}`)
      )
      .run();
    db.update(taskActivity)
      .set({ status: 'inactive', updatedAt: new Date().toISOString() })
      .where(
        and(eq(taskActivity.status, 'idle'), sql`${taskActivity.lastEventAt} < ${inactiveCutoff}`)
      )
      .run();
  }

  /**
   * Mark a task inactive (e.g. on teardown). Preserves activity history so a
   * follow-up session in the same task can still see what was last touched.
   */
  markInactive(taskId: string): void {
    const now = new Date().toISOString();
    db.update(taskActivity)
      .set({ status: 'inactive', updatedAt: now })
      .where(eq(taskActivity.taskId, taskId))
      .run();
  }

  /**
   * List sibling tasks in the same project, excluding `excludeTaskId`.
   * Returns active + idle tasks (not inactive) — siblings that have gone
   * quiet for >2h are filtered out.
   */
  listSiblings(projectId: string, excludeTaskId: string): SiblingTask[] {
    const rows = db
      .select({
        taskId: tasks.id,
        projectId: tasks.projectId,
        taskBranch: tasks.taskBranch,
        name: tasks.name,
        status: taskActivity.status,
        summary: taskActivity.summary,
        lastEventAt: taskActivity.lastEventAt,
      })
      .from(taskActivity)
      .innerJoin(tasks, eq(taskActivity.taskId, tasks.id))
      .where(
        and(
          eq(tasks.projectId, projectId),
          ne(tasks.id, excludeTaskId),
          isNull(tasks.archivedAt),
          inArray(taskActivity.status, ['active', 'idle'])
        )
      )
      .all();

    if (rows.length === 0) return [];

    const fileRows = db
      .select()
      .from(taskTouchedFiles)
      .where(
        inArray(
          taskTouchedFiles.taskId,
          rows.map((r) => r.taskId)
        )
      )
      .all();

    const byTask = new Map<string, string[]>();
    for (const f of fileRows) {
      const arr = byTask.get(f.taskId) ?? [];
      arr.push(f.filePath);
      byTask.set(f.taskId, arr);
    }

    return rows.map((r) => ({
      taskId: r.taskId,
      projectId: r.projectId,
      branch: r.taskBranch ?? null,
      name: r.name,
      status: r.status as CoordinationStatus,
      summary: r.summary,
      lastEventAt: r.lastEventAt,
      touchedFiles: byTask.get(r.taskId) ?? [],
    }));
  }

  /**
   * For each path in `paths`, return the sibling tasks (excluding excludeTaskId)
   * that have touched it. Empty array entries are omitted from results.
   */
  findOverlap(projectId: string, excludeTaskId: string, paths: string[]): FileOverlap[] {
    if (paths.length === 0) return [];

    const rows = db
      .select({
        path: taskTouchedFiles.filePath,
        taskId: tasks.id,
        branch: tasks.taskBranch,
        name: tasks.name,
        lastTouchedAt: taskTouchedFiles.lastTouchedAt,
      })
      .from(taskTouchedFiles)
      .innerJoin(tasks, eq(taskTouchedFiles.taskId, tasks.id))
      .innerJoin(taskActivity, eq(taskActivity.taskId, tasks.id))
      .where(
        and(
          eq(tasks.projectId, projectId),
          ne(tasks.id, excludeTaskId),
          isNull(tasks.archivedAt),
          inArray(taskActivity.status, ['active', 'idle']),
          inArray(taskTouchedFiles.filePath, paths)
        )
      )
      .all();

    const byPath = new Map<string, FileOverlap>();
    for (const r of rows) {
      const entry = byPath.get(r.path) ?? { path: r.path, siblings: [] };
      entry.siblings.push({
        taskId: r.taskId,
        branch: r.branch ?? null,
        name: r.name,
        lastTouchedAt: r.lastTouchedAt,
      });
      byPath.set(r.path, entry);
    }
    return [...byPath.values()];
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      try {
        this.flush();
      } catch {
        // Swallow — best-effort persistence.
      }
    }, this.flushIntervalMs);
  }
}

export const activityStore = new ActivityStore();
