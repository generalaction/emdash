import { dialog } from 'electron';
import _electronUpdater, {
  type ProgressInfo,
  type UpdateInfo,
  type Logger as UpdaterLogger,
} from 'electron-updater';
import { PRODUCT_NAME, UPDATE_CHANNEL } from '@shared/app-identity';
import { menuOpenSettingsChannel } from '@shared/events/appEvents';
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
import { getMainWindow } from '@main/app/window';
import { resolveAppVersion } from '@main/core/app/utils';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { formatUpdaterError, sanitizeUpdaterLogArgs } from './utils';

const { autoUpdater } = _electronUpdater;

const ALLOW_PRERELEASE = false;
const ALLOW_DOWNGRADE = false;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const STARTUP_DELAY_MS = 30 * 1000; // 30 seconds
const INSTALL_RESTART_GUARD_TIMEOUT_MS = 2 * 60 * 1000;

export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error';
  lastCheck?: Date;
  nextCheck?: Date;
  currentVersion: string;
  availableVersion?: string;
  updateInfo?: UpdateInfo;
  downloadProgress?: {
    bytesPerSecond: number;
    percent: number;
    transferred: number;
    total: number;
  };
  error?: string;
  rollbackVersion?: string;
  releaseNotes?: string;
}

class UpdateService {
  private updateState: UpdateState;
  private checkTimer?: NodeJS.Timeout;
  private currentCheckPromise: Promise<UpdateInfo | null> | null = null;
  private initialized = false;
  private active = false;
  private installRequested = false;
  private installRestartGuardTimer?: NodeJS.Timeout;
  private userInitiatedDialogPending = false;

  constructor() {
    this.updateState = {
      status: 'idle',
      currentVersion: 'unknown',
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    this.updateState.currentVersion = await resolveAppVersion();

    if (import.meta.env.DEV) return;

    this.setupAutoUpdater();
    this.setupEventListeners();
    this.active = true;

    log.info('AutoUpdateService initialized', {
      version: this.updateState.currentVersion,
      channel: UPDATE_CHANNEL,
    });

    this.scheduleNextCheck(STARTUP_DELAY_MS);
  }

  private setupAutoUpdater(): void {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.autoRunAppAfterInstall = true;
    autoUpdater.channel = UPDATE_CHANNEL;
    autoUpdater.allowPrerelease = ALLOW_PRERELEASE;
    autoUpdater.allowDowngrade = ALLOW_DOWNGRADE;
    autoUpdater.requestHeaders = { 'Cache-Control': 'no-cache' };

    const updaterLogger: UpdaterLogger = {
      info: (...args: unknown[]) => log.debug('[autoUpdater]', ...sanitizeUpdaterLogArgs(args)),
      warn: (...args: unknown[]) => log.warn('[autoUpdater]', ...sanitizeUpdaterLogArgs(args)),
      error: (...args: unknown[]) => log.error('[autoUpdater]', ...sanitizeUpdaterLogArgs(args)),
    };
    autoUpdater.logger = updaterLogger;
  }

  private setupEventListeners(): void {
    autoUpdater.on('checking-for-update', () => {
      this.updateState.status = 'checking';
      this.updateState.lastCheck = new Date();
      events.emit(updateCheckingEvent, undefined);
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.updateState.status = 'available';
      this.updateState.availableVersion = info.version;
      this.updateState.updateInfo = info;
      events.emit(updateAvailableEvent, { version: info.version, updateInfo: info });
    });

    autoUpdater.on('update-not-available', () => {
      this.updateState.status = 'idle';
      events.emit(updateNotAvailableEvent, undefined);
    });

    autoUpdater.on('error', (err: Error) => {
      const errorMessage = formatUpdaterError(err);
      log.error('Auto-updater error:', errorMessage);

      if (this.updateState.status === 'installing') {
        log.warn('Ignoring auto-updater error while install is in progress');
        return;
      }

      const previousVersion = this.updateState.availableVersion;
      const previousInfo = this.updateState.updateInfo;

      this.updateState.status = 'error';
      this.updateState.error = errorMessage;

      if (previousVersion) {
        this.updateState.availableVersion = previousVersion;
        this.updateState.updateInfo = previousInfo;
      }

      events.emit(updateErrorEvent, { message: errorMessage });
    });

    autoUpdater.on('download-progress', (progressObj: ProgressInfo) => {
      this.updateState.status = 'downloading';
      this.updateState.downloadProgress = {
        bytesPerSecond: progressObj.bytesPerSecond,
        percent: progressObj.percent,
        transferred: progressObj.transferred,
        total: progressObj.total,
      };
      events.emit(updateProgressEvent, {
        bytesPerSecond: progressObj.bytesPerSecond,
        percent: progressObj.percent,
        transferred: progressObj.transferred,
        total: progressObj.total,
      });
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.updateState.status = 'downloaded';
      this.updateState.rollbackVersion = this.updateState.currentVersion;
      events.emit(updateDownloadedEvent, { version: info.version });
    });
  }

  private scheduleNextCheck(delay = CHECK_INTERVAL_MS): void {
    if (this.checkTimer) {
      clearTimeout(this.checkTimer);
    }
    this.updateState.nextCheck = new Date(Date.now() + delay);
    this.checkTimer = setTimeout(() => {
      this.checkForUpdates().catch((e) => {
        log.error('Scheduled update check failed:', e);
      });
    }, delay);
  }

  async checkForUpdates(): Promise<UpdateInfo | null> {
    if (!this.active) return null;
    if (this.currentCheckPromise) return this.currentCheckPromise;

    this.currentCheckPromise = this._performCheck().finally(() => {
      this.currentCheckPromise = null;
      this.scheduleNextCheck();
    });

    return this.currentCheckPromise;
  }

  async checkForUpdatesUserInitiated(): Promise<void> {
    if (this.userInitiatedDialogPending) return;
    this.userInitiatedDialogPending = true;

    try {
      if (import.meta.env.DEV) {
        await this.showUpdateDialog({
          type: 'info',
          message: 'Updates are disabled in development mode.',
        });
        return;
      }

      if (!this.active) {
        await this.showUpdateDialog({
          type: 'warning',
          message: 'The update service is not available.',
        });
        return;
      }

      try {
        const info = await this.checkForUpdates();

        if (info) {
          await this.presentUpdateAvailable(info.version);
        } else if (
          this.updateState.status === 'available' ||
          this.updateState.status === 'downloading' ||
          this.updateState.status === 'downloaded'
        ) {
          await this.presentUpdateAvailable(
            this.updateState.availableVersion ?? this.updateState.currentVersion
          );
        } else if (this.updateState.status === 'error') {
          await this.presentUpdateError(this.updateState.error ?? 'An unknown error occurred.');
        } else {
          await this.presentUpToDate();
        }
      } catch (error) {
        await this.presentUpdateError(formatUpdaterError(error));
      }
    } finally {
      this.userInitiatedDialogPending = false;
    }
  }

  private async presentUpToDate(): Promise<void> {
    await this.showUpdateDialog({
      type: 'info',
      message: `${PRODUCT_NAME} is up to date.`,
      detail: `You're running version ${this.updateState.currentVersion}, the latest available version.`,
    });
  }

  private async presentUpdateAvailable(version: string): Promise<void> {
    const choice = await this.showUpdateDialog({
      type: 'info',
      message: `A new version of ${PRODUCT_NAME} is available.`,
      detail: `Version ${version} is available — you have ${this.updateState.currentVersion}. Open Settings to download and install.`,
      buttons: ['Open Settings', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice.response === 0) {
      events.emit(menuOpenSettingsChannel, undefined);
    }
  }

  private async presentUpdateError(message: string): Promise<void> {
    await this.showUpdateDialog({
      type: 'error',
      message: 'Could not check for updates.',
      detail: message,
    });
  }

  private async showUpdateDialog(
    options: Pick<
      Electron.MessageBoxOptions,
      'type' | 'message' | 'detail' | 'buttons' | 'defaultId' | 'cancelId'
    >
  ): Promise<Electron.MessageBoxReturnValue> {
    const win = getMainWindow();
    const merged: Electron.MessageBoxOptions = {
      title: 'Check for Updates',
      buttons: ['OK'],
      defaultId: 0,
      ...options,
    };
    return win ? dialog.showMessageBox(win, merged) : dialog.showMessageBox(merged);
  }

  private async _performCheck(): Promise<UpdateInfo | null> {
    if (this.updateState.status === 'error') {
      this.updateState.status = 'idle';
      this.updateState.error = undefined;
    }

    log.info('Checking for updates...', {
      channel: UPDATE_CHANNEL,
      currentVersion: this.updateState.currentVersion,
    });

    const result = await autoUpdater.checkForUpdatesAndNotify();
    return result?.updateInfo ?? null;
  }

  async downloadUpdate(): Promise<void> {
    if (!this.active) throw new Error('Update service is not active');
    if (this.updateState.status === 'error' && this.updateState.availableVersion) {
      this.updateState.status = 'available';
    }

    if (this.updateState.status !== 'available') {
      throw new Error(`Cannot download: status is "${this.updateState.status}", not "available"`);
    }

    if (!this.updateState.availableVersion) {
      throw new Error('No version information available for download');
    }

    this.updateState.status = 'downloading';
    events.emit(updateDownloadingEvent, { version: this.updateState.availableVersion });

    try {
      await autoUpdater.downloadUpdate();
    } catch (error: unknown) {
      const errorMessage = formatUpdaterError(error);
      log.error('Update download failed:', errorMessage, error);

      const version = this.updateState.availableVersion;
      const info = this.updateState.updateInfo;

      this.updateState.status = 'error';
      this.updateState.error = errorMessage;
      this.updateState.availableVersion = version;
      this.updateState.updateInfo = info;

      events.emit(updateErrorEvent, { message: errorMessage });
      throw error;
    }
  }

  quitAndInstall(): void {
    if (!this.active) throw new Error('Update service is not active');
    if (this.installRequested) {
      log.info('quitAndInstall ignored: install already requested');
      return;
    }

    if (this.updateState.status !== 'downloaded') {
      throw new Error(
        `Cannot install update: status is "${this.updateState.status}", expected "downloaded"`
      );
    }

    this.installRequested = true;
    this.updateState.status = 'installing';
    events.emit(updateInstallingEvent, undefined);

    log.info('Installing update', {
      fromVersion: this.updateState.currentVersion,
      toVersion: this.updateState.availableVersion,
    });

    const clearGuard = () => {
      if (this.installRestartGuardTimer) {
        clearTimeout(this.installRestartGuardTimer);
        this.installRestartGuardTimer = undefined;
      }
    };

    const rollback = (reason: string) => {
      clearGuard();
      this.installRequested = false;
      this.updateState.status = 'downloaded';
      if (this.updateState.availableVersion) {
        events.emit(updateDownloadedEvent, { version: this.updateState.availableVersion });
      }
      log.error(reason);
    };

    this.installRestartGuardTimer = setTimeout(() => {
      rollback('quitAndInstall timed out before app quit; allowing retry');
    }, INSTALL_RESTART_GUARD_TIMEOUT_MS);

    setTimeout(() => {
      try {
        autoUpdater.quitAndInstall(false, true);
      } catch (error) {
        rollback(`quitAndInstall threw: ${formatUpdaterError(error)}`);
      }
    }, 250);
  }

  async fetchReleaseNotes(): Promise<string | null> {
    try {
      if (!this.updateState.updateInfo) {
        return null;
      }

      const releaseNotes = this.updateState.updateInfo.releaseNotes;
      if (releaseNotes) {
        const normalizedReleaseNotes =
          typeof releaseNotes === 'string'
            ? releaseNotes
            : releaseNotes
                .map((note) => note.note)
                .filter((note): note is string => typeof note === 'string' && note.length > 0)
                .join('\n\n');
        if (normalizedReleaseNotes) {
          this.updateState.releaseNotes = normalizedReleaseNotes;
          return normalizedReleaseNotes;
        }
      }

      const version = this.updateState.availableVersion;
      if (!version) return null;

      const response = await fetch(
        `https://api.github.com/repos/generalaction/emdash/releases/tags/v${version}`
      );

      if (response.ok) {
        const data = (await response.json()) as { body?: string };
        const notes = data.body || 'No release notes available';
        this.updateState.releaseNotes = notes;
        return notes;
      }

      return null;
    } catch (error) {
      log.error('Failed to fetch release notes:', error);
      return null;
    }
  }

  getState(): UpdateState {
    return { ...this.updateState };
  }

  shutdown(): void {
    if (this.checkTimer) {
      clearTimeout(this.checkTimer);
      this.checkTimer = undefined;
    }
    if (this.installRestartGuardTimer) {
      clearTimeout(this.installRestartGuardTimer);
      this.installRestartGuardTimer = undefined;
    }
  }
}

export const updateService = new UpdateService();
