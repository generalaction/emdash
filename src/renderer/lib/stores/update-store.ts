import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import { toast } from 'sonner';
import { menuCheckForUpdatesChannel } from '@shared/events/appEvents';
import {
  updateAvailableEvent,
  updateCheckingEvent,
  updateDownloadedEvent,
  updateDownloadingEvent,
  updateErrorEvent,
  updateInstallingEvent,
  updateNotAvailableEvent,
  updateProgressEvent,
} from '@shared/events/updateEvents';
import { EMDASH_RELEASES_URL } from '@shared/urls';
import { events, rpc } from '../../lib/ipc';

const LAST_NOTIFIED_KEY = 'emdash:update:lastNotified';
const SNOOZE_HOURS = 6;

type DownloadProgress = {
  percent?: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
};

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; info?: { version: string } }
  | { status: 'not-available' }
  | { status: 'downloading'; progress?: DownloadProgress }
  | { status: 'downloaded' }
  | { status: 'installing' }
  | { status: 'error'; message: string };

export class UpdateStore {
  state: UpdateState = { status: 'idle' };
  currentVersion = '';
  availableVersion: string | undefined = undefined;

  constructor() {
    makeObservable(this, {
      state: observable,
      currentVersion: observable,
      availableVersion: observable,
      setState: action,
      hasUpdate: computed,
      progressLabel: computed,
    });
  }

  get hasUpdate(): boolean {
    const { status } = this.state;
    return status === 'available' || status === 'downloading' || status === 'downloaded';
  }

  setState(state: UpdateState): void {
    this.state = state;
  }

  get progressLabel(): string {
    if (this.state.status !== 'downloading') return '';
    const p = this.state.progress?.percent ?? 0;
    return `${p.toFixed(0)}%`;
  }

  start(): void {
    rpc.app.getAppVersion().then((v) => {
      runInAction(() => {
        this.currentVersion = v;
      });
    });

    events.on(updateCheckingEvent, () => {
      runInAction(() => {
        this.state = { status: 'checking' };
      });
    });

    events.on(updateAvailableEvent, (d) => {
      runInAction(() => {
        this.availableVersion = d.version;
        this.state = { status: 'available', info: { version: d.version } };
      });
      this._maybeToastAvailable(d.version);
    });

    events.on(updateNotAvailableEvent, () => {
      runInAction(() => {
        this.state = { status: 'not-available' };
      });
    });

    events.on(updateDownloadingEvent, (_d) => {
      runInAction(() => {
        this.state = { status: 'downloading', progress: { percent: 0 } };
      });
    });

    events.on(updateProgressEvent, (d) => {
      runInAction(() => {
        this.state = {
          status: 'downloading',
          progress: {
            percent: d.percent,
            transferred: d.transferred,
            total: d.total,
            bytesPerSecond: d.bytesPerSecond,
          },
        };
      });
    });

    events.on(updateDownloadedEvent, () => {
      runInAction(() => {
        this.state = { status: 'downloaded' };
      });
    });

    events.on(updateInstallingEvent, () => {
      runInAction(() => {
        this.state = { status: 'installing' };
      });
    });

    events.on(updateErrorEvent, (d) => {
      runInAction(() => {
        this.state = { status: 'error', message: d.message };
      });
    });

    events.on(menuCheckForUpdatesChannel, () => {
      rpc.update.check().catch(() => {});
    });

    rpc.update.check().catch(() => {});
  }

  async check(): Promise<void> {
    runInAction(() => {
      this.state = { status: 'checking' };
    });
    try {
      const res = await rpc.update.check();
      if (!res) {
        runInAction(() => {
          this.state = { status: 'error', message: 'Update API unavailable' };
        });
        return;
      }
      if (!res.success) {
        runInAction(() => {
          this.state = { status: 'error', message: res.error ?? 'Failed to check for updates' };
        });
      } else if (res.result === null) {
        runInAction(() => {
          this.state = { status: 'idle' };
        });
      }
    } catch {
      runInAction(() => {
        this.state = { status: 'error', message: 'Failed to check for updates' };
      });
    }
  }

  async download(): Promise<void> {
    try {
      const res = await rpc.update.download();
      if (!res) {
        runInAction(() => {
          this.state = { status: 'error', message: 'Update API unavailable' };
        });
        return;
      }
      if (!res.success) {
        const message = res.error ?? 'Failed to download update';
        runInAction(() => {
          this.state = { status: 'error', message };
        });
      }
    } catch {
      runInAction(() => {
        this.state = { status: 'error', message: 'Failed to download update' };
      });
    }
  }

  async install(): Promise<void> {
    runInAction(() => {
      this.state = { status: 'installing' };
    });
    try {
      const res = await rpc.update.quitAndInstall();
      if (!res) {
        runInAction(() => {
          this.state = { status: 'error', message: 'Update API unavailable' };
        });
        return;
      }
      if (!res.success) {
        runInAction(() => {
          this.state = { status: 'error', message: res.error ?? 'Failed to install update' };
        });
      }
    } catch {
      runInAction(() => {
        this.state = { status: 'error', message: 'Failed to install update' };
      });
    }
  }

  async openLatest(): Promise<void> {
    try {
      await rpc.update.openLatest();
    } catch {
      // openLatest quits the app — errors are best-effort
    }
  }

  private _maybeToastAvailable(version: string): void {
    if (!this._shouldNotify(version)) return;
    toast('Update Available', {
      description: `Version ${version} is ready. View the changelog for details.`,
      action: {
        label: 'View Changelog',
        onClick: () => rpc.app.openExternal(EMDASH_RELEASES_URL).catch(() => {}),
      },
    });
    this._rememberNotified(version);
  }

  private _shouldNotify(version: string): boolean {
    try {
      const raw = localStorage.getItem(LAST_NOTIFIED_KEY);
      if (!raw) return true;
      const parsed = JSON.parse(raw) as { version?: string; at?: number };
      if (parsed.version === version) {
        const at = parsed.at ?? 0;
        if (Date.now() - at < Math.max(1, SNOOZE_HOURS) * 3_600_000) return false;
      }
      return true;
    } catch {
      return true;
    }
  }

  private _rememberNotified(version: string): void {
    try {
      localStorage.setItem(LAST_NOTIFIED_KEY, JSON.stringify({ version, at: Date.now() }));
    } catch {
      // localStorage may be unavailable
    }
  }
}
