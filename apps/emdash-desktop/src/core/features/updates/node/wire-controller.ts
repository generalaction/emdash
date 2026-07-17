import { createController, type Controller } from '@emdash/wire/api';
import { app, shell } from 'electron';
import { EMDASH_RELEASES_URL } from '@core/primitives/urls/api/urls';
import { updateService } from '@main/host/updates/update-service';
import { formatUpdaterError } from '@main/host/updates/utils';
import { updatesContract } from '../api';
import { updateEvents } from './event-host';

export function createUpdatesWireController(): Controller {
  return createController(updatesContract, {
    check: async () => {
      try {
        const result = await updateService.checkForUpdates();
        return { success: true as const, result: result ?? null };
      } catch (error) {
        return { success: false as const, error: formatUpdaterError(error) };
      }
    },
    download: async () => {
      try {
        await updateService.downloadUpdate();
        return { success: true as const };
      } catch (error) {
        return { success: false as const, error: formatUpdaterError(error) };
      }
    },
    quitAndInstall: async () => {
      try {
        updateService.quitAndInstall();
        return { success: true as const };
      } catch (error) {
        return { success: false as const, error: formatUpdaterError(error) };
      }
    },
    openLatest: async () => {
      try {
        await shell.openExternal(EMDASH_RELEASES_URL);
        setTimeout(() => {
          try {
            app.quit();
          } catch {}
        }, 500);
        return { success: true as const };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    getState: async () => {
      try {
        return { success: true as const, data: updateService.getState() };
      } catch (error) {
        return { success: false as const, error: formatUpdaterError(error) };
      }
    },
    getReleaseNotes: async () => {
      try {
        return { success: true as const, data: await updateService.fetchReleaseNotes() };
      } catch (error) {
        return { success: false as const, error: formatUpdaterError(error) };
      }
    },
    events: updateEvents,
  });
}
