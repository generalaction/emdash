import { app, dialog } from 'electron';
import { initializeFileLogger } from '@main/host/file-logger';
import { showRecoveryWindow } from '@main/host/recovery/recovery-window';
import { updateService } from '@main/host/updates/update-service';
import { log } from '@main/lib/logger';

/*
 * Recovery is the last-resort import path after a failed application update.
 * Keep this module and its transitive imports independent from the database,
 * desktop workers, and the Wire gateway so native/runtime load failures cannot
 * prevent the recovery window from opening.
 */

let safeModeQuitHandlerRegistered = false;

export async function enterSafeMode(error: unknown): Promise<void> {
  initializeFileLogger();
  const errorMessage = error instanceof Error ? error.message : String(error);
  log.error('Boot failed; entering recovery mode', { error });
  registerSafeModeQuitHandler();

  await app.whenReady();
  try {
    await updateService.initialize();
  } catch (updateError) {
    log.warn('Auto-updater is unavailable in recovery mode', { error: updateError });
  }

  try {
    await showRecoveryWindow({ errorMessage });
  } catch (windowError) {
    log.error('Failed to open recovery window', { error: windowError });
    dialog.showErrorBox(
      'Something went wrong',
      `Emdash could not start or open recovery mode.\n\n${errorMessage}`
    );
  }
}

function registerSafeModeQuitHandler(): void {
  if (safeModeQuitHandlerRegistered) return;
  safeModeQuitHandlerRegistered = true;
  // Intentionally do not prevent the event. Normal shutdown services were not
  // initialized, and electron-updater must be allowed to install on app quit.
  app.on('before-quit', () => {});
}
