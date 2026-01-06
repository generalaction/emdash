import { app, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import { log } from '../lib/logger';
import { formatUpdaterError, sanitizeUpdaterLogArgs } from '../lib/updaterError';
import { autoUpdateService } from './AutoUpdateService';

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
        autoUpdater.quitAndInstall(false, true);
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

  // Enhanced IPC handlers for AutoUpdateService
  ipcMain.handle('update:get-state', async () => {
    try {
      const state = autoUpdateService.getState();
      return { success: true, data: state };
    } catch (error) {
      return { success: false, error: formatUpdaterError(error) };
    }
  });

  ipcMain.handle('update:get-settings', async () => {
    try {
      const settings = autoUpdateService.getSettings();
      return { success: true, data: settings };
    } catch (error) {
      return { success: false, error: formatUpdaterError(error) };
    }
  });

  ipcMain.handle('update:update-settings', async (_event, settings: any) => {
    try {
      await autoUpdateService.updateSettings(settings);
      return { success: true };
    } catch (error) {
      return { success: false, error: formatUpdaterError(error) };
    }
  });

  ipcMain.handle('update:get-release-notes', async () => {
    try {
      const notes = await autoUpdateService.fetchReleaseNotes();
      return { success: true, data: notes };
    } catch (error) {
      return { success: false, error: formatUpdaterError(error) };
    }
  });

  ipcMain.handle('update:check-now', async () => {
    try {
      const result = await autoUpdateService.checkForUpdates(false);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: formatUpdaterError(error) };
    }
  });
}
