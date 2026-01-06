import { app, BrowserWindow } from 'electron';
import { autoUpdater, UpdateInfo } from 'electron-updater';
import { log } from '../lib/logger';
import { formatUpdaterError, sanitizeUpdaterLogArgs } from '../lib/updaterError';

// Update check intervals (in milliseconds)
const UPDATE_CHECK_INTERVALS = {
  startup: 5 * 60 * 1000, // 5 minutes after startup
  periodic: 4 * 60 * 60 * 1000, // Every 4 hours
  manual: 0, // Immediate for manual checks
} as const;

// Update channels for staged rollouts
export enum UpdateChannel {
  STABLE = 'stable',
  BETA = 'beta',
  ALPHA = 'alpha',
  NIGHTLY = 'nightly',
}

// Enhanced update state with more details
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
    remainingTime?: number;
  };
  error?: string;
  rollbackVersion?: string;
  releaseNotes?: string;
  channel: UpdateChannel;
}

// Settings interface
export interface UpdateSettings {
  autoCheck: boolean;
  autoDownload: boolean;
  checkInterval: number;
  channel: UpdateChannel;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
}

class AutoUpdateService {
  private updateState: UpdateState;
  private checkTimer?: NodeJS.Timeout;
  private settings: UpdateSettings;
  private initialized = false;
  private lastNotifiedVersion?: string;
  private downloadStartTime?: number;

  constructor() {
    const appVersion = this.getAppVersion();

    this.updateState = {
      status: 'idle',
      currentVersion: appVersion,
      channel: UpdateChannel.STABLE,
    };

    this.settings = {
      autoCheck: true,
      autoDownload: false, // Always false by default - user must opt-in to download
      checkInterval: UPDATE_CHECK_INTERVALS.periodic,
      channel: UpdateChannel.STABLE,
      allowPrerelease: false,
      allowDowngrade: false,
    };

    // Don't setup autoUpdater in constructor - wait for initialize()
  }

  private getAppVersion(): string {
    try {
      const { readFileSync } = require('fs');
      const { join } = require('path');

      // In development, look for package.json in project root
      const isDev = !app.isPackaged || process.env.NODE_ENV === 'development';

      const possiblePaths = isDev
        ? [
            join(__dirname, '../../../../package.json'), // from dist/main/main/services
            join(__dirname, '../../../package.json'),
            join(process.cwd(), 'package.json'),
          ]
        : [join(app.getAppPath(), 'package.json')];

      for (const path of possiblePaths) {
        try {
          const packageJson = JSON.parse(readFileSync(path, 'utf-8'));
          if (packageJson.name === 'emdash' && packageJson.version) {
            return packageJson.version;
          }
        } catch {
          continue;
        }
      }

      // Fallback: hardcoded version for dev
      return '0.3.46';
    } catch {
      return '0.3.46';
    }
  }

  /**
   * Initialize the auto-update service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Skip auto-updates in development - always
    const isDev = !app.isPackaged || process.env.NODE_ENV === 'development';
    if (isDev) {
      // Silent in dev - no logs
      this.initialized = true;
      return;
    }

    this.initialized = true;

    // Setup and configure autoUpdater only for production
    this.setupAutoUpdater();

    // Load settings from database
    await this.loadSettings();

    // Configure auto-updater based on settings
    this.applySettings();

    // Setup event listeners
    this.setupEventListeners();

    // Schedule initial update check after startup delay
    if (this.settings.autoCheck) {
      this.scheduleUpdateCheck(UPDATE_CHECK_INTERVALS.startup);
    }

    log.info('AutoUpdateService initialized', {
      version: this.updateState.currentVersion,
      channel: this.settings.channel,
      autoCheck: this.settings.autoCheck,
      autoDownload: this.settings.autoDownload,
    });
  }

  /**
   * Setup electron-updater configuration
   */
  private setupAutoUpdater(): void {
    // Basic configuration
    autoUpdater.autoDownload = false; // We'll manage downloads manually
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.autoRunAppAfterInstall = true;

    // Custom logger for production
    autoUpdater.logger = {
      info: (...args: any[]) => log.debug('[autoUpdater]', ...sanitizeUpdaterLogArgs(args)),
      warn: (...args: any[]) => log.warn('[autoUpdater]', ...sanitizeUpdaterLogArgs(args)),
      error: (...args: any[]) => log.warn('[autoUpdater]', ...sanitizeUpdaterLogArgs(args)),
    } as any;
  }

  /**
   * Setup event listeners for auto-updater
   */
  private setupEventListeners(): void {
    autoUpdater.on('checking-for-update', () => {
      this.updateState.status = 'checking';
      this.updateState.lastCheck = new Date();
      this.notifyWindows('checking');
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.updateState.status = 'available';
      this.updateState.availableVersion = info.version;
      this.updateState.updateInfo = info;
      this.notifyWindows('available', info);

      // Auto-download if enabled and not already notified about this version
      if (this.settings.autoDownload && info.version !== this.lastNotifiedVersion) {
        this.lastNotifiedVersion = info.version;
        setTimeout(() => this.downloadUpdate(), 2000); // Small delay for UI to update
      }
    });

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      this.updateState.status = 'idle';
      this.scheduleNextCheck();
      this.notifyWindows('not-available', info);
    });

    autoUpdater.on('error', (err: Error) => {
      this.updateState.status = 'error';
      this.updateState.error = formatUpdaterError(err);
      this.notifyWindows('error', { message: this.updateState.error });

      // Retry after error
      if (this.settings.autoCheck) {
        this.scheduleUpdateCheck(UPDATE_CHECK_INTERVALS.periodic);
      }
    });

    autoUpdater.on('download-progress', (progressObj: any) => {
      this.updateState.status = 'downloading';

      // Calculate remaining time
      const now = Date.now();
      let remainingTime: number | undefined;
      if (this.downloadStartTime && progressObj.bytesPerSecond > 0) {
        const elapsedSeconds = (now - this.downloadStartTime) / 1000;
        const totalSeconds = progressObj.total / progressObj.bytesPerSecond;
        remainingTime = Math.max(0, totalSeconds - elapsedSeconds);
      }

      this.updateState.downloadProgress = {
        bytesPerSecond: progressObj.bytesPerSecond,
        percent: progressObj.percent,
        transferred: progressObj.transferred,
        total: progressObj.total,
        remainingTime,
      };

      this.notifyWindows('download-progress', progressObj);
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.updateState.status = 'downloaded';
      this.downloadStartTime = undefined;
      this.notifyWindows('downloaded', info);

      // Store rollback info
      this.updateState.rollbackVersion = this.updateState.currentVersion;
    });
  }

  /**
   * Load settings from environment variables
   */
  private async loadSettings(): Promise<void> {
    try {
      // Load from environment variables (settings persist in memory during session)
      const envChannel = process.env.EMDASH_UPDATE_CHANNEL;
      if (envChannel && Object.values(UpdateChannel).includes(envChannel as UpdateChannel)) {
        this.settings.channel = envChannel as UpdateChannel;
      }

      const envAutoCheck = process.env.EMDASH_AUTO_CHECK_UPDATES;
      if (envAutoCheck === 'false') {
        this.settings.autoCheck = false;
      }

      const envAutoDownload = process.env.EMDASH_AUTO_DOWNLOAD_UPDATES;
      if (envAutoDownload === 'true') {
        this.settings.autoDownload = true;
      }
    } catch (error) {
      log.error('Failed to load update settings:', error);
    }
  }

  /**
   * Apply current settings to auto-updater
   */
  private applySettings(): void {
    // Set update channel
    if (this.settings.channel !== UpdateChannel.STABLE) {
      autoUpdater.channel = this.settings.channel;
    }

    // Set prerelease flag
    autoUpdater.allowPrerelease = this.settings.allowPrerelease;

    // Set downgrade flag
    autoUpdater.allowDowngrade = this.settings.allowDowngrade;
  }

  /**
   * Schedule an update check
   */
  private scheduleUpdateCheck(delay: number): void {
    // Clear existing timer
    if (this.checkTimer) {
      clearTimeout(this.checkTimer);
    }

    if (delay > 0) {
      this.updateState.nextCheck = new Date(Date.now() + delay);
      this.checkTimer = setTimeout(() => {
        this.checkForUpdates(true); // Silent check
      }, delay);
    } else {
      this.checkForUpdates(false); // Immediate check
    }
  }

  /**
   * Schedule the next periodic check
   */
  private scheduleNextCheck(): void {
    if (this.settings.autoCheck) {
      this.scheduleUpdateCheck(this.settings.checkInterval);
    }
  }

  /**
   * Check for updates
   */
  async checkForUpdates(silent = false): Promise<UpdateInfo | null> {
    try {
      // Skip in development - always
      const isDev = !app.isPackaged || process.env.NODE_ENV === 'development';
      if (isDev) {
        return null;
      }

      log.info('Checking for updates...', {
        channel: this.settings.channel,
        currentVersion: this.updateState.currentVersion,
      });

      const result = await autoUpdater.checkForUpdatesAndNotify();

      // Schedule next check
      this.scheduleNextCheck();

      return result?.updateInfo || null;
    } catch (error) {
      log.error('Update check failed:', error);
      this.updateState.status = 'error';
      this.updateState.error = formatUpdaterError(error);

      if (!silent) {
        this.notifyWindows('error', { message: this.updateState.error });
      }

      // Schedule retry
      this.scheduleNextCheck();

      return null;
    }
  }

  /**
   * Download the available update
   */
  async downloadUpdate(): Promise<void> {
    try {
      if (this.updateState.status !== 'available') {
        throw new Error('No update available to download');
      }

      this.downloadStartTime = Date.now();
      await autoUpdater.downloadUpdate();
    } catch (error) {
      log.error('Update download failed:', error);
      this.updateState.status = 'error';
      this.updateState.error = formatUpdaterError(error);
      this.downloadStartTime = undefined;
      this.notifyWindows('error', { message: this.updateState.error });
    }
  }

  /**
   * Install the downloaded update and restart
   */
  quitAndInstall(): void {
    // Save current state for potential rollback
    this.saveRollbackInfo();

    // Small delay to ensure UI can respond
    setTimeout(() => {
      autoUpdater.quitAndInstall(false, true);
    }, 250);
  }

  /**
   * Save rollback information
   */
  private saveRollbackInfo(): void {
    try {
      // Log rollback information for debugging purposes
      log.info('Saving rollback info:', {
        fromVersion: this.updateState.currentVersion,
        toVersion: this.updateState.availableVersion,
      });
    } catch (error) {
      log.error('Failed to save rollback info:', error);
    }
  }

  /**
   * Fetch release notes for the available update
   */
  async fetchReleaseNotes(): Promise<string | null> {
    try {
      if (!this.updateState.updateInfo) {
        return null;
      }

      // Try to get from updateInfo first
      const releaseNotes = (this.updateState.updateInfo as any).releaseNotes;
      if (releaseNotes) {
        this.updateState.releaseNotes = releaseNotes;
        return releaseNotes;
      }

      // Otherwise fetch from GitHub API
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

  /**
   * Update user settings
   */
  async updateSettings(newSettings: Partial<UpdateSettings>): Promise<void> {
    this.settings = { ...this.settings, ...newSettings };

    // Apply new settings
    this.applySettings();

    // Settings persist in memory for the current session
    // Reschedule checks if needed
    if (this.settings.autoCheck) {
      this.scheduleNextCheck();
    } else if (this.checkTimer) {
      clearTimeout(this.checkTimer);
      this.checkTimer = undefined;
    }

    log.info('Update settings changed:', this.settings);
  }

  /**
   * Get current update state
   */
  getState(): UpdateState {
    return { ...this.updateState };
  }

  /**
   * Get current settings
   */
  getSettings(): UpdateSettings {
    return { ...this.settings };
  }

  /**
   * Notify all windows about update events
   */
  private notifyWindows(event: string, payload?: any): void {
    const channel = `update:${event}`;
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.webContents.send(channel, payload);
      } catch {
        // Window might be destroyed
      }
    }
  }

  /**
   * Format bytes to human readable string
   */
  formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  /**
   * Format time to human readable string
   */
  formatTime(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${Math.round(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
  }

  /**
   * Cleanup on shutdown
   */
  shutdown(): void {
    if (this.checkTimer) {
      clearTimeout(this.checkTimer);
      this.checkTimer = undefined;
    }
  }
}

// Export singleton instance
export const autoUpdateService = new AutoUpdateService();
