import { app, ipcMain, net } from 'electron';
import { autoUpdater } from 'electron-updater';
import { log } from '../lib/logger';
import { formatUpdaterError, sanitizeUpdaterLogArgs } from '../lib/updaterError';
import { getAppSettings } from '../settings';

// Channels used to notify renderer about update lifecycle
const UpdateChannels = {
  checking: 'update:checking',
  available: 'update:available',
  notAvailable: 'update:not-available',
  error: 'update:error',
  progress: 'update:download-progress',
  downloaded: 'update:downloaded',
} as const;

// Centralized dev-mode hints
const DEV_HINT_CHECK = 'Updates are disabled in development.';
const DEV_HINT_DOWNLOAD = 'Cannot download updates in development.';

// Basic updater configuration
// Publish config is provided via electron-builder (package.json -> build.publish)
// We keep autoDownload off; downloads start only when the user clicks.
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.logger = {
  info: (...args: any[]) => log.debug('[autoUpdater]', ...sanitizeUpdaterLogArgs(args)),
  warn: (...args: any[]) => log.warn('[autoUpdater]', ...sanitizeUpdaterLogArgs(args)),
  error: (...args: any[]) => log.warn('[autoUpdater]', ...sanitizeUpdaterLogArgs(args)),
} as any;

// Enable dev update testing if explicitly opted in
const isDev = !app.isPackaged || process.env.NODE_ENV === 'development';
if (isDev && process.env.EMDASH_DEV_UPDATES === 'true') {
  try {
    // Allow using dev-app-update.yml when not packaged
    // See: https://www.electron.build/auto-update#testing-in-development
    (autoUpdater as any).forceDevUpdateConfig = true;
    if (process.env.EMDASH_DEV_UPDATE_CONFIG) {
      // Optionally specify a custom config path
      (autoUpdater as any).updateConfigPath = process.env.EMDASH_DEV_UPDATE_CONFIG;
    }
  } catch {
    // ignore if not supported by type defs/runtime
  }
}

// Helper: emit update events to all renderer windows
function emit(channel: string, payload?: any) {
  const { BrowserWindow } = require('electron');
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send(channel, payload);
    } catch {}
  }
}

let initialized = false;
function ensureInitialized() {
  if (initialized) return;
  initialized = true;

  // Wire autoUpdater events
  autoUpdater.on('checking-for-update', () => emit(UpdateChannels.checking));
  autoUpdater.on('update-available', (info) => emit(UpdateChannels.available, info));
  autoUpdater.on('update-not-available', (info) => emit(UpdateChannels.notAvailable, info));
  autoUpdater.on('error', (err) =>
    emit(UpdateChannels.error, { message: formatUpdaterError(err) })
  );
  autoUpdater.on('download-progress', (progress) => emit(UpdateChannels.progress, progress));
  autoUpdater.on('update-downloaded', (info) => emit(UpdateChannels.downloaded, info));
}

// Fallback: open latest download link in browser for manual install
function getLatestDownloadUrl(): string {
  const platform = process.platform;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const baseUrl = 'https://github.com/generalaction/emdash/releases/latest/download';

  switch (platform) {
    case 'darwin':
      return `${baseUrl}/emdash-${arch}.dmg`;
    case 'linux':
      // For Linux, prefer AppImage (more universal)
      return `${baseUrl}/emdash-x86_64.AppImage`;
    case 'win32':
      // For Windows, prefer portable exe
      return `${baseUrl}/emdash-x64.exe`;
    default:
      // Fallback to releases page
      return 'https://github.com/generalaction/emdash/releases/latest';
  }
}

export function registerUpdateIpc() {
  ensureInitialized();

  // Initialize autoDownload from saved settings
  try {
    const settings = getAppSettings();
    autoUpdater.autoDownload = settings.updates?.autoDownload ?? false;
    log.info('[autoUpdater] Initialized autoDownload from settings:', autoUpdater.autoDownload);
  } catch (error) {
    log.warn('[autoUpdater] Failed to load autoDownload setting, using default (false)');
  }

  ipcMain.handle('update:check', async () => {
    try {
      const dev = !app.isPackaged || process.env.NODE_ENV === 'development';
      const forced =
        (autoUpdater as any)?.forceDevUpdateConfig === true ||
        process.env.EMDASH_DEV_UPDATES === 'true';
      if (dev && !forced) {
        return {
          success: false,
          error: DEV_HINT_CHECK,
          devDisabled: true,
        } as any;
      }
      const result = await autoUpdater.checkForUpdates();
      // electron-updater returns UpdateCheckResult or throws
      return { success: true, result: result ?? null };
    } catch (error) {
      return { success: false, error: formatUpdaterError(error) };
    }
  });

  ipcMain.handle('update:download', async () => {
    try {
      const dev = !app.isPackaged || process.env.NODE_ENV === 'development';
      const forced =
        (autoUpdater as any)?.forceDevUpdateConfig === true ||
        process.env.EMDASH_DEV_UPDATES === 'true';
      if (dev && !forced) {
        return {
          success: false,
          error: DEV_HINT_DOWNLOAD,
          devDisabled: true,
        } as any;
      }
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (error) {
      return { success: false, error: formatUpdaterError(error) };
    }
  });

  ipcMain.handle('update:quit-and-install', async () => {
    try {
      // Slight delay to ensure renderer can process the response
      setTimeout(() => {
        // quitAndInstall(isSilent = false)
        // isSilent=false shows UI dialogs during install (user-friendly)
        autoUpdater.quitAndInstall(false);
      }, 250);
      return { success: true };
    } catch (error) {
      return { success: false, error: formatUpdaterError(error) };
    }
  });

  ipcMain.handle('update:open-latest', async () => {
    try {
      const { shell } = require('electron');
      await shell.openExternal(getLatestDownloadUrl());
      // Gracefully quit after opening the external download link so the user can install
      setTimeout(() => {
        try {
          app.quit();
        } catch {}
      }, 500);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Expose app version for simple comparisons on renderer
  ipcMain.handle('update:get-version', () => app.getVersion());
}

// Helper: Check network connectivity
async function isOnline(): Promise<boolean> {
  try {
    const response = await net.fetch('https://api.github.com/zen');
    return response.ok;
  } catch {
    return false;
  }
}

// Helper: Retry logic with exponential backoff
async function checkForUpdatesWithRetry(maxRetries = 3, delayMs = 5000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await autoUpdater.checkForUpdates();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      const backoffDelay = delayMs * attempt; // exponential backoff
      log.warn(`[autoUpdater] Check failed (attempt ${attempt}/${maxRetries}), retrying in ${backoffDelay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, backoffDelay));
    }
  }
}

// Check for updates on app startup (delayed to avoid blocking startup)
export function checkForUpdatesOnStartup() {
  // Wait a bit after app ready to avoid blocking startup
  setTimeout(async () => {
    try {
      const settings = getAppSettings();
      if (!settings.updates?.autoCheck) {
        log.debug('[autoUpdater] Auto-check disabled in settings');
        return;
      }

      const isDev = !app.isPackaged || process.env.NODE_ENV === 'development';
      const forced = process.env.EMDASH_DEV_UPDATES === 'true';
      if (isDev && !forced) {
        log.debug('[autoUpdater] Skipping startup check (dev mode)');
        return;
      }

      // Check network connectivity first
      const online = await isOnline();
      if (!online) {
        log.debug('[autoUpdater] Offline, skipping startup check');
        return;
      }

      log.info('[autoUpdater] Checking for updates on startup...');
      await checkForUpdatesWithRetry();
    } catch (error) {
      log.warn('[autoUpdater] Startup check failed:', error);
      // Silent failure - don't interrupt user experience
    }
  }, 10_000); // 10 second delay after app ready
}

// Periodic update checking
let checkInterval: NodeJS.Timeout | null = null;

export function startPeriodicUpdateChecks(intervalMs?: number) {
  const settings = getAppSettings();
  if (!settings.updates?.autoCheck) {
    log.debug('[autoUpdater] Periodic checks disabled in settings');
    return;
  }

  // Use setting or provided interval, default to 24 hours
  const interval = intervalMs ?? (settings.updates?.checkIntervalHours ?? 24) * 60 * 60 * 1000;

  if (checkInterval) clearInterval(checkInterval);

  checkInterval = setInterval(async () => {
    try {
      const isDev = !app.isPackaged || process.env.NODE_ENV === 'development';
      const forced = process.env.EMDASH_DEV_UPDATES === 'true';
      if (isDev && !forced) return;

      // Check network connectivity first
      const online = await isOnline();
      if (!online) {
        log.debug('[autoUpdater] Offline, skipping periodic check');
        return;
      }

      log.info('[autoUpdater] Periodic update check...');
      await checkForUpdatesWithRetry();
    } catch (error) {
      log.warn('[autoUpdater] Periodic check failed:', error);
    }
  }, interval);

  log.info(`[autoUpdater] Periodic checks enabled (interval: ${interval / 1000 / 60 / 60}h)`);
}

export function stopPeriodicUpdateChecks() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
    log.info('[autoUpdater] Periodic checks stopped');
  }
}

// Update autoDownload setting dynamically
export function updateAutoDownloadSetting(enabled: boolean) {
  autoUpdater.autoDownload = enabled;
  log.info('[autoUpdater] autoDownload set to', enabled);
}
