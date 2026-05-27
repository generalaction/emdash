import { taskManager } from '@main/core/tasks/task-manager';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { log } from '@main/lib/logger';
import { activityStore } from './activity-store';

/**
 * Recompute the touched-file set for a task by asking its workspace for the
 * current git status. Universal across providers — no per-agent parsing.
 *
 * Hook events drive *when* a scan happens (a debounced trigger), git is the
 * truth for *which* paths. Repo-relative paths land in `task_touched_files`.
 */
export async function scanTask(taskId: string): Promise<void> {
  const workspaceId = taskManager.getWorkspaceId(taskId);
  if (!workspaceId) return;
  const workspace = workspaceRegistry.get(workspaceId);
  if (!workspace) return;

  try {
    const status = await workspace.git.getFullStatus();
    const paths = new Set<string>();
    for (const c of status.staged) paths.add(c.path);
    for (const c of status.unstaged) paths.add(c.path);
    activityStore.replaceTouches(taskId, [...paths]);
  } catch (e) {
    // Worktree may be torn down mid-scan; not a hard error.
    log.warn('coordination.scanTask: git status failed', { taskId, error: String(e) });
  }
}

/**
 * Coalesces rapid-fire scan requests per task so a burst of hook events
 * doesn't translate to a flood of git invocations. Each task gets a single
 * pending scan with a short delay.
 */
class ScanScheduler {
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly delayMs = 1500;

  schedule(taskId: string): void {
    const existing = this.pending.get(taskId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.pending.delete(taskId);
      void scanTask(taskId);
    }, this.delayMs);
    this.pending.set(taskId, timer);
  }

  cancel(taskId: string): void {
    const t = this.pending.get(taskId);
    if (t) {
      clearTimeout(t);
      this.pending.delete(taskId);
    }
  }

  cancelAll(): void {
    for (const t of this.pending.values()) clearTimeout(t);
    this.pending.clear();
  }
}

export const scanScheduler = new ScanScheduler();
