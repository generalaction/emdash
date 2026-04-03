import { app, shell } from 'electron';
import { createRPCController } from '@shared/ipc/rpc';
import { EMDASH_RELEASES_URL } from '@shared/urls';
import { updateService } from '@main/core/updates/update-service';
import { formatUpdaterError } from './utils';

const DEV_HINT_CHECK = 'Updates are disabled in development.';
const DEV_HINT_DOWNLOAD = 'Cannot download updates in development.';

const isDev = !app.isPackaged || process.env.NODE_ENV === 'development';

function getLatestDownloadUrl(): string {
  return EMDASH_RELEASES_URL;
}

export const updateController = createRPCController({
  check: async () => {
    try {
      if (isDev) {
        return { success: false, error: DEV_HINT_CHECK, devDisabled: true };
      }
      const result = await updateService.checkForUpdates();
      return { success: true, result: result ?? null };
    } catch (error) {
      return { success: false, error: formatUpdaterError(error) };
    }
  },

  download: async () => {
    try {
      if (isDev) {
        return { success: false, error: DEV_HINT_DOWNLOAD, devDisabled: true };
      }
      await updateService.downloadUpdate();
      return { success: true };
    } catch (error) {
      return { success: false, error: formatUpdaterError(error) };
    }
  },

  quitAndInstall: async () => {
    try {
      updateService.quitAndInstall();
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
      const state = updateService.getState();
      return { success: true, data: state };
    } catch (error) {
      return { success: false, error: formatUpdaterError(error) };
    }
  },

  getReleaseNotes: async () => {
    try {
      const notes = await updateService.fetchReleaseNotes();
      return { success: true, data: notes };
    } catch (error) {
      return { success: false, error: formatUpdaterError(error) };
    }
  },

  checkNow: async () => {
    try {
      const result = await updateService.checkForUpdates();
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: formatUpdaterError(error) };
    }
  },
});
