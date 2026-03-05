import { app, shell } from 'electron';
import { formatUpdaterError } from '../lib/updaterError';
import { autoUpdateService } from './AutoUpdateService';
import { createRPCController } from '../../shared/ipc/rpc';

const DEV_HINT_CHECK = 'Updates are disabled in development.';
const DEV_HINT_DOWNLOAD = 'Cannot download updates in development.';

// Skip all auto-updater setup in development
const isDev = !app.isPackaged || process.env.NODE_ENV === 'development';

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
      // For Windows, prefer the installer exe (NSIS)
      return `${baseUrl}/emdash-x64.exe`;
    default:
      // Fallback to releases page
      return 'https://github.com/generalaction/emdash/releases/latest';
  }
}

export const updateController = createRPCController({
  check: async () => {
    try {
      if (isDev) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { success: false, error: DEV_HINT_CHECK, devDisabled: true } as any;
      }
      const result = await autoUpdateService.checkForUpdates(false);
      return { success: true, result: result ?? null };
    } catch (error) {
      return { success: false, error: formatUpdaterError(error) };
    }
  },

  download: async () => {
    try {
      if (isDev) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { success: false, error: DEV_HINT_DOWNLOAD, devDisabled: true } as any;
      }
      await autoUpdateService.downloadUpdate();
      return { success: true };
    } catch (error) {
      return { success: false, error: formatUpdaterError(error) };
    }
  },

  quitAndInstall: async () => {
    try {
      autoUpdateService.quitAndInstall();
      return { success: true };
    } catch (error) {
      return { success: false, error: formatUpdaterError(error) };
    }
  },

  openLatest: async () => {
    try {
      await shell.openExternal(getLatestDownloadUrl());
      setTimeout(() => {
        try {
          app.quit();
        } catch {}
      }, 500);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  getVersion: () => app.getVersion(),

  getState: async () => {
    try {
      const state = autoUpdateService.getState();
      return { success: true, data: state };
    } catch (error) {
      return { success: false, error: formatUpdaterError(error) };
    }
  },

  getSettings: async () => {
    try {
      const settings = autoUpdateService.getSettings();
      return { success: true, data: settings };
    } catch (error) {
      return { success: false, error: formatUpdaterError(error) };
    }
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateSettings: async (settings: any) => {
    try {
      await autoUpdateService.updateSettings(settings);
      return { success: true };
    } catch (error) {
      return { success: false, error: formatUpdaterError(error) };
    }
  },

  getReleaseNotes: async () => {
    try {
      const notes = await autoUpdateService.fetchReleaseNotes();
      return { success: true, data: notes };
    } catch (error) {
      return { success: false, error: formatUpdaterError(error) };
    }
  },

  checkNow: async () => {
    try {
      const result = await autoUpdateService.checkForUpdates(false);
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: formatUpdaterError(error) };
    }
  },
});
