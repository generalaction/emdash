import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { BrowserWindow } from 'electron';
import { databaseService } from './DatabaseService';
import { getAppSettings } from '../settings';
import { log } from '../lib/logger';

const execAsync = promisify(exec);

const POLL_INTERVAL_MS = 60_000; // 60 seconds

class PrMergeWatcherService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  start(): void {
    this.restartTimer();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Call after settings change to re-evaluate whether polling is needed. */
  onSettingsChanged(): void {
    this.restartTimer();
  }

  private restartTimer(): void {
    this.stop();
    const setting = getAppSettings().tasks?.autoCleanupOnPrMerge ?? 'off';
    if (setting === 'off') return;

    this.timer = setInterval(() => {
      void this.poll();
    }, POLL_INTERVAL_MS);

    // Also run an initial poll soon (after a short delay to let the app settle).
    setTimeout(() => void this.poll(), 5_000);
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;

    try {
      const setting = getAppSettings().tasks?.autoCleanupOnPrMerge ?? 'off';
      if (setting === 'off') return;

      const tasks = await databaseService.getTasks();
      for (const task of tasks) {
        if (!task.path || !existsSync(task.path)) continue;

        try {
          const merged = await this.isPrMerged(task.path);
          if (!merged) continue;

          if (setting === 'archive') {
            await databaseService.archiveTask(task.id);
          } else if (setting === 'delete') {
            await databaseService.deleteTask(task.id);
          }

          this.notifyRenderer({
            taskId: task.id,
            projectId: task.projectId,
            action: setting,
          });

          log.info(
            `[PrMergeWatcher] Auto-${setting}d task "${task.name}" (${task.id}) — PR merged`
          );
        } catch (err) {
          // Per-task errors are expected (no PR, gh not installed, etc.)
          log.debug(`[PrMergeWatcher] Skipping task ${task.id}:`, err);
        }
      }
    } catch (err) {
      log.error('[PrMergeWatcher] Poll failed:', err);
    } finally {
      this.polling = false;
    }
  }

  private async isPrMerged(cwd: string): Promise<boolean> {
    const { stdout } = await execAsync('gh pr view --json state -q .state', {
      cwd,
      timeout: 15_000,
    });
    return stdout.trim() === 'MERGED';
  }

  private notifyRenderer(payload: { taskId: string; projectId: string; action: string }): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('task:auto-cleaned', payload);
      }
    }
  }
}

export const prMergeWatcherService = new PrMergeWatcherService();
