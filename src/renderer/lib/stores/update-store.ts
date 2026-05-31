import { ArrowUpRight } from 'lucide-react';
import { action, computed, makeObservable, observable, reaction, runInAction } from 'mobx';
import { createElement, type ReactNode } from 'react';
import { toast } from 'sonner';
import { events, rpc } from '@renderer/lib/ipc';
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
  // Integer percent shown in the UI. The real updater fires `download-progress`
  // events in coarse chunks (often ~10% at a time), so between events we
  // project forward using the updater's own `bytesPerSecond` measurement — the
  // displayed percent is therefore a real bandwidth-driven estimate of bytes
  // actually transferred, not an arbitrary easing.
  displayedPercent = 0;
  private _downloadSimulationTimer: ReturnType<typeof setInterval> | undefined;
  private _percentAnimationFrame: number | undefined;
  // Anchor for forward projection: the last real progress event we saw.
  private _lastProgressTransferred = 0;
  private _lastProgressTotal = 0;
  private _lastProgressBytesPerSecond = 0;
  private _lastProgressAt = 0;
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
      displayedPercent: observable,
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
    return `${this.displayedPercent}%`;
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
      this._resetPercentAnimation();
      runInAction(() => {
        this.state = { status: 'downloading', progress: { percent: 0 } };
      });
      this._anchorProgress({ percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 });
      this._startPercentAnimation();
    });

    events.on(updateProgressEvent, (d) => {
      const normalized = normalizeDownloadProgress(d);
      runInAction(() => {
        this.state = {
          status: 'downloading',
          progress: normalized,
        };
      });
      this._anchorProgress(normalized);
      this._startPercentAnimation();
    });

    events.on(updateDownloadedEvent, () => {
      runInAction(() => {
        this.state = { status: 'downloaded' };
      });
      this._completePercentAnimation();
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
          this.state = {
            status: 'error',
            message: res.error ?? 'Failed to check for updates',
          };
        });
      } else if (res.result === null) {
        runInAction(() => {
          this.state = { status: 'idle' };
        });
      }
    } catch {
      runInAction(() => {
        this.state = {
          status: 'error',
          message: 'Failed to check for updates',
        };
      });
    }
  }

  async download(): Promise<void> {
    if (import.meta.env.DEV && this._simulating) {
      this.simulateDownloadProgress();
      return;
    }
    this._resetPercentAnimation();
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
          this.state = {
            status: 'error',
            message: res.error ?? 'Failed to install update',
          };
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
    this._resetPercentAnimation();
    this._simulating = true;
    this._showToast();

    const total = 100 * 1024 * 1024;
    let transferred = 0;

    const initial = normalizeDownloadProgress({
      bytesPerSecond: 0,
      percent: 0,
      transferred,
      total,
    });
    runInAction(() => {
      this.availableVersion = 'test';
      this.state = { status: 'downloading', progress: initial };
    });
    this._anchorProgress(initial);
    this._startPercentAnimation();

    this._downloadSimulationTimer = setInterval(() => {
      transferred = Math.min(total, transferred + total / 20);

      const next = normalizeDownloadProgress({
        bytesPerSecond: total / 10,
        percent: 0,
        transferred,
        total,
      });
      runInAction(() => {
        this.state = { status: 'downloading', progress: next };
      });
      this._anchorProgress(next);

      if (transferred >= total) {
        this._stopDownloadSimulation();
        runInAction(() => {
          this.state = { status: 'downloaded' };
        });
        this._completePercentAnimation();
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

  resetUpdateState(): void {
    if (!import.meta.env.DEV) return;
    this._stopDownloadSimulation();
    this._resetPercentAnimation();
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

  /**
   * Snapshot the latest real progress event. The animation loop uses this
   * anchor plus the elapsed time and the updater's reported `bytesPerSecond`
   * to project how many bytes have actually been transferred since.
   */
  private _anchorProgress(progress: DownloadProgress): void {
    const transferred = progress.transferred ?? 0;
    const total = progress.total ?? 0;
    this._lastProgressTransferred = transferred;
    this._lastProgressTotal = total;
    this._lastProgressBytesPerSecond = progress.bytesPerSecond ?? 0;
    this._lastProgressAt = this._now();
    // Snap to the real percent immediately on each event so we never drift
    // ahead of (or behind) what the updater actually reported.
    const real = total > 0 ? (transferred / total) * 100 : (progress.percent ?? 0);
    const rounded = Math.max(this.displayedPercent, Math.floor(real));
    if (rounded !== this.displayedPercent) {
      runInAction(() => {
        this.displayedPercent = rounded;
      });
    }
  }

  /**
   * Project bytes transferred between progress events using the real measured
   * bandwidth from the updater, then derive percent from bytes. This is a
   * bandwidth-grounded estimate — when the network truly stalls, the displayed
   * percent stalls too. We cap the projection just shy of the next 10%-chunk
   * boundary so we don't claim to have crossed a chunk before the real event
   * confirms it.
   */
  private _startPercentAnimation(): void {
    if (typeof requestAnimationFrame === 'undefined') {
      // Non-browser environments (tests): just reflect the anchor.
      return;
    }
    if (this._percentAnimationFrame !== undefined) return;
    const step = (): void => {
      if (this.state.status !== 'downloading') {
        this._percentAnimationFrame = undefined;
        return;
      }

      const total = this._lastProgressTotal;
      const bps = this._lastProgressBytesPerSecond;
      if (total > 0 && bps > 0) {
        const elapsed = (this._now() - this._lastProgressAt) / 1000;
        const projectedBytes = this._lastProgressTransferred + bps * elapsed;
        // Stay just shy of the next expected chunk boundary so the projection
        // can never overtake reality before the next event confirms it. The
        // updater tends to fire `download-progress` in ~10% steps, so 9% lets
        // the counter cover almost the whole gap without ever leaping past it.
        const ceiling = Math.min(total, this._lastProgressTransferred + total * 0.09);
        const projected = Math.min(projectedBytes, ceiling, total);
        const projectedPercent = (projected / total) * 100;
        const rounded = Math.floor(projectedPercent);
        if (rounded > this.displayedPercent && rounded < 100) {
          runInAction(() => {
            this.displayedPercent = rounded;
          });
        }
      }

      this._percentAnimationFrame = requestAnimationFrame(step);
    };
    this._percentAnimationFrame = requestAnimationFrame(step);
  }

  private _completePercentAnimation(): void {
    this._stopPercentAnimation();
    runInAction(() => {
      this.displayedPercent = 100;
    });
  }

  private _stopPercentAnimation(): void {
    if (this._percentAnimationFrame !== undefined && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this._percentAnimationFrame);
    }
    this._percentAnimationFrame = undefined;
  }

  private _resetPercentAnimation(): void {
    this._stopPercentAnimation();
    this._lastProgressTransferred = 0;
    this._lastProgressTotal = 0;
    this._lastProgressBytesPerSecond = 0;
    this._lastProgressAt = 0;
    runInAction(() => {
      this.displayedPercent = 0;
    });
  }

  private _now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
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
    if (s.status === 'downloading') return `downloading:${this.displayedPercent}`;
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
    action?: {
      label: ReactNode;
      onClick: (event: { preventDefault: () => void }) => void;
    };
  } | null {
    const version = this.availableVersion;
    switch (this.state.status) {
      case 'available':
        return {
          title: 'Update available',
          description: version
            ? `Version ${version} is ready to download.`
            : 'A new version is ready to download.',
          action: {
            label: this._actionLabel('Update'),
            onClick: (event) => {
              event.preventDefault();
              void this.download();
            },
          },
        };
      case 'downloading':
        return {
          title: 'Downloading update',
          description: version ? `Version ${version}` : 'Fetching the latest version…',
          // Mirror the "Update available" layout: the action button now reports
          // progress. preventDefault keeps clicking it from dismissing the toast.
          action: {
            label: this._percentLabel(this.displayedPercent),
            onClick: (event) => event.preventDefault(),
          },
        };
      case 'downloaded':
        return {
          title: 'Update ready',
          description: `Restart ${PRODUCT_NAME} to finish updating.`,
          action: {
            label: this._actionLabel('Restart'),
            onClick: (event) => {
              event.preventDefault();
              void this.install();
            },
          },
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
          action: {
            label: this._actionLabel('Retry'),
            onClick: (event) => {
              event.preventDefault();
              void this.download();
            },
          },
        };
      default:
        return null;
    }
  }

  private _actionLabel(label: string): ReactNode {
    return createElement(
      'span',
      { className: 'inline-flex items-center gap-1' },
      label,
      createElement(ArrowUpRight, {
        className:
          'h-3 w-3 transition-transform duration-150 ease-out group-hover/update-action:translate-x-0.5 group-hover/update-action:-translate-y-0.5',
      })
    );
  }

  /**
   * Percent label with tabular figures so each digit has the same width. The
   * toast button only resizes when the digit count itself changes (9→10 and
   * 99→100) instead of on every tick.
   */
  private _percentLabel(percent: number): ReactNode {
    return createElement('span', { className: 'tabular-nums' }, `${percent}%`);
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
