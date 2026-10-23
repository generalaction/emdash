import { toast } from '@emdash/ui/react/primitives';
import { ArrowUpRight } from 'lucide-react';
import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import { settingsViewDef } from '@core/features/settings/contributions/views';
import type { DesktopUpdateEvent, DesktopUpdateState } from '@core/features/updates/api';
import { getHostClient } from '@core/primitives/desktop-host/browser/host-client';
import { getNavigation } from '@core/primitives/navigation/browser/navigation-selectors';
import { getUpdatesClient } from '../api/browser/client';

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
  | { status: 'error'; message: string; details?: string };

export class UpdateStore {
  state: UpdateState = { status: 'idle' };
  currentVersion = '';
  downloadRequested = false;
  private stateRevision = 0;
  availableVersion: string | undefined = undefined;

  constructor() {
    makeObservable(this, {
      state: observable,
      currentVersion: observable,
      downloadRequested: observable,
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
    this.stateRevision++;
    this.state = state;
  }

  get progressLabel(): string {
    if (this.state.status !== 'downloading') return '';
    const p = this.state.progress?.percent ?? 0;
    return `${p.toFixed(0)}%`;
  }

  start(): void {
    void this._startWire();

    void getHostClient().then((client) => {
      void client.events.subscribe(undefined, {
        onEvent: (event) => {
          if (event.type === 'menu-check-for-updates') void this.check();
        },
        onGap: () => {},
      });
    });
  }

  private get hasPendingUpdate(): boolean {
    return (
      this.state.status === 'downloading' ||
      this.state.status === 'downloaded' ||
      this.state.status === 'installing'
    );
  }

  async check(): Promise<void> {
    if (this.downloadRequested || this.hasPendingUpdate) return;
    try {
      const client = await getUpdatesClient();
      const res = await client.check(undefined);
      if (!res.success) {
        await this._recoverAction(res.error);
      } else {
        await this._refreshWireState();
      }
    } catch {
      await this._recoverAction('Failed to check for updates');
    }
  }

  async download(): Promise<void> {
    if (this.downloadRequested || this.hasPendingUpdate) return;
    runInAction(() => {
      this.downloadRequested = true;
    });
    try {
      const client = await getUpdatesClient();
      const revision = this.stateRevision;
      const res = await client.download(undefined);
      if (res.success) {
        this._applySnapshot(res.data, revision);
      } else {
        await this._recoverAction(res.error);
      }
    } catch {
      await this._recoverAction('Could not confirm the update status. Please check again.');
    } finally {
      runInAction(() => {
        this.downloadRequested = false;
      });
    }
  }

  private async _recoverAction(message: string): Promise<void> {
    const refreshed = await this._refreshWireState();
    if (this.hasPendingUpdate || (refreshed && this.state.status === 'error')) return;
    this.setState({ status: 'error', message });
  }

  async install(): Promise<void> {
    this.setState({ status: 'installing' });
    try {
      const client = await getUpdatesClient();
      const res = await client.quitAndInstall(undefined);
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
      const client = await getUpdatesClient();
      await client.openLatest(undefined);
    } catch {
      // openLatest quits the app — errors are best-effort
    }
  }

  private async _startWire(): Promise<void> {
    const client = await getUpdatesClient();
    await client.events.subscribe(undefined, {
      onEvent: (event) => this._applyEvent(event),
      onGap: () => void this._refreshWireState(),
    });
    await this._refreshWireState();
    await this.check();
  }

  private async _refreshWireState(): Promise<boolean> {
    try {
      const client = await getUpdatesClient();
      const revision = this.stateRevision;
      const result = await client.getState(undefined);
      if (!result.success) return false;
      this._applySnapshot(result.data, revision);
      return true;
    } catch {
      return false;
    }
  }

  private _applySnapshot(snapshot: DesktopUpdateState, revision: number): void {
    runInAction(() => {
      this.currentVersion = snapshot.currentVersion;
      this.availableVersion ??= snapshot.availableVersion;
    });
    if (revision !== this.stateRevision) return;
    this.stateRevision++;
    runInAction(() => {
      this.availableVersion = snapshot.availableVersion;
      switch (snapshot.status) {
        case 'available':
          this.state = {
            status: 'available',
            info: snapshot.availableVersion ? { version: snapshot.availableVersion } : undefined,
          };
          break;
        case 'downloading':
          this.state = { status: 'downloading', progress: snapshot.downloadProgress };
          break;
        case 'error':
          this.state = {
            status: 'error',
            message: snapshot.error ?? 'Update failed',
            details: snapshot.errorDetails,
          };
          break;
        case 'idle':
        case 'checking':
        case 'downloaded':
        case 'installing':
          this.state = { status: snapshot.status };
          break;
      }
    });
  }

  private _applyEvent(event: DesktopUpdateEvent): void {
    this.stateRevision++;
    runInAction(() => {
      switch (event.type) {
        case 'checking':
          this.state = { status: 'checking' };
          break;
        case 'available':
          this.availableVersion = event.version;
          this.state = { status: 'available', info: { version: event.version } };
          break;
        case 'not-available':
          this.state = { status: 'not-available' };
          break;
        case 'downloading':
          this.availableVersion = event.version;
          this.state = { status: 'downloading' };
          break;
        case 'progress':
          this.state = {
            status: 'downloading',
            progress: {
              percent: event.percent,
              transferred: event.transferred,
              total: event.total,
              bytesPerSecond: event.bytesPerSecond,
            },
          };
          break;
        case 'downloaded':
          this.state = { status: 'downloaded' };
          break;
        case 'installing':
          this.state = { status: 'installing' };
          break;
        case 'error':
          this.state = { status: 'error', message: event.message, details: event.details };
          break;
      }
    });
    if (event.type === 'available') this._maybeToastAvailable(event.version);
  }

  private _maybeToastAvailable(version: string): void {
    if (!this._shouldNotify(version)) return;
    this._showAvailableToast(version);
    this._rememberNotified(version);
  }

  private _showAvailableToast(version: string): void {
    toast('Update Available', {
      description: `Version ${version} is available to download and install.`,
      duration: 10_000,
      action: {
        label: (
          <span className="flex items-center gap-1.5">
            Update
            <ArrowUpRight className="size-3.5" />
          </span>
        ),
        onClick: () => {
          getNavigation().navigate(settingsViewDef({ tab: 'general' }));
          if (this.state.status === 'available') {
            void this.download();
          }
        },
      },
    });
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
