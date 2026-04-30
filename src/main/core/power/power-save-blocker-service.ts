import { powerSaveBlocker } from 'electron';
import { log } from '@main/lib/logger';
import { ptySessionRegistry } from '../pty/pty-session-registry';
import { appSettingsService } from '../settings/settings-service';

const BLOCKER_KIND = 'prevent-display-sleep';

class PowerSaveBlockerService {
  private blockerId: number | null = null;
  private enabled = false;
  private disposers: Array<() => void> = [];
  private started = false;

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    try {
      const tasks = await appSettingsService.get('tasks');
      if (!this.started) return;
      this.enabled = tasks.keepAwakeWhileRunning;
    } catch (err) {
      if (!this.started) return;
      log.warn('PowerSaveBlocker: failed to read initial setting:', err);
      this.enabled = false;
    }

    this.disposers.push(ptySessionRegistry.onActiveSessionsChange(() => this.reconcile()));

    this.disposers.push(
      appSettingsService.onChange((key) => {
        if (key !== 'tasks') return;
        appSettingsService
          .get('tasks')
          .then((tasks) => {
            if (!this.started) return;
            const next = tasks.keepAwakeWhileRunning;
            if (next === this.enabled) return;
            this.enabled = next;
            this.reconcile();
          })
          .catch((err) => {
            log.warn('PowerSaveBlocker: failed to read updated setting:', err);
          });
      })
    );

    this.reconcile();
  }

  shutdown(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
    this.stopBlocker();
    this.started = false;
  }

  private reconcile(): void {
    const shouldBlock = this.enabled && ptySessionRegistry.getActiveSessionCount() > 0;
    if (shouldBlock) {
      this.startBlocker();
    } else {
      this.stopBlocker();
    }
  }

  private startBlocker(): void {
    if (this.blockerId !== null) return;
    try {
      this.blockerId = powerSaveBlocker.start(BLOCKER_KIND);
      log.info(`PowerSaveBlocker: started (${BLOCKER_KIND}, id=${this.blockerId})`);
    } catch (err) {
      this.blockerId = null;
      log.warn('PowerSaveBlocker: failed to start:', err);
    }
  }

  private stopBlocker(): void {
    if (this.blockerId === null) return;
    try {
      powerSaveBlocker.stop(this.blockerId);
      log.info(`PowerSaveBlocker: stopped (id=${this.blockerId})`);
      this.blockerId = null;
    } catch (err) {
      log.warn('PowerSaveBlocker: failed to stop:', err);
    }
  }
}

export const powerSaveBlockerService = new PowerSaveBlockerService();
