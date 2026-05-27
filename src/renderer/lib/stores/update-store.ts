import { action, computed, makeObservable, observable, reaction, runInAction } from 'mobx';
import { toast } from 'sonner';
import { PRODUCT_NAME } from '@shared/app-identity';
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
import { events, rpc } from '@renderer/lib/ipc';
import { normalizeDownloadProgress, type DownloadProgress } from './update-progress';

const LAST_NOTIFIED_KEY = 'emdash:update:lastNotified';
const SNOOZE_HOURS = 6;
const UPDATE_TOAST_ID = 'emdash-update';

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
  private _downloadSimulationTimer: ReturnType<typeof setInterval> | undefined;
  // Whether the update toast is currently meant to be on screen. Gates the
  // reaction so background progress events don't resurrect a dismissed toast.
  private _toastActive = false;
  // Dev-only: when true, download()/install() play the simulated flow instead of
  // calling the real updater RPC, so the full end-to-end UX can be exercised.
  private _simulating = false;

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
    void rpc.app.getAppVersion().then((v) => {
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
          progress: normalizeDownloadProgress(d),
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

    // Keep the live toast in sync with the flow: re-render whenever the status
    // or download percentage changes, but only while a toast is meant to show.
    reaction(
      () => this._toastKey,
      () => {
        if (this._toastActive) this._renderToast();
      }
    );

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
    if (import.meta.env.DEV && this._simulating) {
      this.simulateDownloadProgress();
      return;
    }
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
    if (import.meta.env.DEV && this._simulating) {
      // Real installs quit the app; for the demo just settle back to idle.
      setTimeout(() => this.resetUpdateState(), 2000);
      return;
    }
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

  /**
   * Surface the update flow to the user. The whole flow — download progress and
   * the restart prompt — lives inside the toast, so this just (re)opens it; the
   * sidebar "Update" button routes here when the toast was dismissed.
   */
  openUpdateFlow(): void {
    this._showToast();
  }

  simulateDownloadProgress(): void {
    if (!import.meta.env.DEV) return;

    this._stopDownloadSimulation();
    this._simulating = true;
    this._showToast();

    const total = 100 * 1024 * 1024;
    let transferred = 0;

    runInAction(() => {
      this.availableVersion = 'test';
      this.state = {
        status: 'downloading',
        progress: normalizeDownloadProgress({
          bytesPerSecond: 0,
          percent: 0,
          transferred,
          total,
        }),
      };
    });

    this._downloadSimulationTimer = setInterval(() => {
      transferred = Math.min(total, transferred + total / 20);

      runInAction(() => {
        this.state = {
          status: 'downloading',
          progress: normalizeDownloadProgress({
            bytesPerSecond: total / 10,
            percent: 0,
            transferred,
            total,
          }),
        };
      });

      if (transferred >= total) {
        this._stopDownloadSimulation();
        runInAction(() => {
          this.state = { status: 'downloaded' };
        });
      }
    }, 250);
  }

  /**
   * Dev-only: play the realistic end-to-end flow. Opens the "update available"
   * toast and arms simulation, so clicking Update downloads with live progress,
   * then Restart, exactly as a real update would feel — without the updater RPC.
   */
  simulateUpdateFlow(): void {
    if (!import.meta.env.DEV) return;
    this._stopDownloadSimulation();
    this._simulating = true;
    runInAction(() => {
      this.availableVersion = 'test';
      this.state = { status: 'available', info: { version: 'test' } };
    });
    this._showToast();
  }

  simulateUpdateToast(): void {
    if (!import.meta.env.DEV) return;
    const version = 'test';
    this._stopDownloadSimulation();
    this._simulating = true;
    runInAction(() => {
      this.availableVersion = version;
      this.state = { status: 'available', info: { version } };
    });
    this._showToast();
  }

  simulateDownloaded(): void {
    if (!import.meta.env.DEV) return;
    this._stopDownloadSimulation();
    this._simulating = true;
    runInAction(() => {
      this.availableVersion = this.availableVersion ?? 'test';
      this.state = { status: 'downloaded' };
    });
    this._showToast();
  }

  simulateInstalling(): void {
    if (!import.meta.env.DEV) return;
    this._stopDownloadSimulation();
    runInAction(() => {
      this.state = { status: 'installing' };
    });
    this._showToast();
  }

  simulateUpdateError(): void {
    if (!import.meta.env.DEV) return;
    this._stopDownloadSimulation();
    this._simulating = true;
    runInAction(() => {
      this.state = { status: 'error', message: 'Simulated update failure' };
    });
    this._showToast();
  }

  resetUpdateState(): void {
    if (!import.meta.env.DEV) return;
    this._stopDownloadSimulation();
    this._simulating = false;
    runInAction(() => {
      this.availableVersion = undefined;
      this.state = { status: 'idle' };
    });
    this._toastActive = false;
    toast.dismiss(UPDATE_TOAST_ID);
  }

  private _stopDownloadSimulation(): void {
    if (this._downloadSimulationTimer) {
      clearInterval(this._downloadSimulationTimer);
      this._downloadSimulationTimer = undefined;
    }
  }

  private _maybeToastAvailable(version: string): void {
    if (!this._shouldNotify(version)) return;
    this._showToast();
    this._rememberNotified(version);
  }

  /**
   * Open the persistent update toast. From here the `reaction` set up in
   * `start()` keeps the same toast (one stable id) advancing through download
   * progress, the restart prompt, and errors as the store state changes.
   */
  private _showToast(): void {
    this._toastActive = true;
    this._renderToast();
  }

  /** A primitive key that changes whenever the toast's content should change. */
  private get _toastKey(): string {
    const s = this.state;
    if (s.status === 'downloading') return `downloading:${Math.round(s.progress?.percent ?? 0)}`;
    if (s.status === 'error') return `error:${s.message}`;
    return s.status;
  }

  /**
   * (Re)render the update toast using sonner's native title/description/action so
   * it matches every other toast: themed card, and an action button that sonner
   * styles and right-aligns for us. Reusing the same id updates it in place.
   */
  private _renderToast(): void {
    const content = this._toastContent();
    if (!content) return;
    toast(content.title, {
      id: UPDATE_TOAST_ID,
      description: content.description,
      action: content.action,
      duration: Infinity,
      onDismiss: () => {
        this._toastActive = false;
      },
    });
  }

  private _toastContent(): {
    title: string;
    description: string;
    action?: { label: string; onClick: (event: { preventDefault: () => void }) => void };
  } | null {
    const version = this.availableVersion;
    switch (this.state.status) {
      case 'available':
        return {
          title: 'Update available',
          description: version
            ? `Version ${version} is ready to download.`
            : 'A new version is ready to download.',
          action: { label: 'Update', onClick: () => void this.download() },
        };
      case 'downloading':
        return {
          title: 'Downloading update',
          description: version ? `Version ${version}` : 'Fetching the latest version…',
          // Mirror the "Update available" layout: the action button now reports
          // progress. preventDefault keeps clicking it from dismissing the toast.
          action: {
            label: `${Math.round(this.state.progress?.percent ?? 0)}%`,
            onClick: (event) => event.preventDefault(),
          },
        };
      case 'downloaded':
        return {
          title: 'Update ready',
          description: `Restart ${PRODUCT_NAME} to finish updating.`,
          action: { label: 'Restart', onClick: () => void this.install() },
        };
      case 'installing':
        return {
          title: 'Installing update',
          description: `${PRODUCT_NAME} will restart automatically…`,
        };
      case 'error':
        return {
          title: 'Update failed',
          description: this.state.message,
          action: { label: 'Retry', onClick: () => void this.download() },
        };
      default:
        return null;
    }
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
