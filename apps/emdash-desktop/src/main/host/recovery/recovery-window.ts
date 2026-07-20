import { dirname, join } from 'node:path';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { updateEvents } from '@core/features/updates/node';
import { clearBootFailureMarker } from '@main/bootstrap/core/boot-guard';
import { getLogFilePath } from '@main/host/file-logger';
import { updateService } from '@main/host/updates/update-service';
import { log } from '@main/lib/logger';
import recoveryHtml from './recovery.html?asset';

export type RecoveryWindowOptions = {
  errorMessage: string;
};

let recoveryWindow: BrowserWindow | undefined;
let recoveryErrorMessage = 'Unknown startup error';
let handlersRegistered = false;

export async function showRecoveryWindow(options: RecoveryWindowOptions): Promise<BrowserWindow> {
  recoveryErrorMessage = options.errorMessage;
  registerRecoveryHandlers();

  if (recoveryWindow && !recoveryWindow.isDestroyed()) {
    recoveryWindow.show();
    recoveryWindow.focus();
    return recoveryWindow;
  }

  const window = new BrowserWindow({
    width: 560,
    height: 480,
    minWidth: 440,
    minHeight: 380,
    title: 'Emdash Recovery',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: join(__dirname, '../preload/recovery.mjs'),
    },
  });
  recoveryWindow = window;

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  const unsubscribe = updateEvents.resolve(undefined).subscribe(() => {
    if (!window.isDestroyed()) window.webContents.send('recovery:update-event');
  });
  window.on('closed', () => {
    unsubscribe();
    if (recoveryWindow === window) recoveryWindow = undefined;
    app.quit();
  });
  window.once('ready-to-show', () => window.show());

  try {
    await window.loadFile(recoveryHtml);
  } catch (error) {
    log.error('Failed to load recovery window asset', { error, recoveryHtml });
    throw error;
  }
  return window;
}

function registerRecoveryHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  ipcMain.handle('recovery:get-state', () => {
    const { updateInfo: _updateInfo, ...update } = updateService.getState();
    return {
      errorMessage: recoveryErrorMessage,
      version: app.getVersion(),
      updaterActive: updateService.isActive,
      update,
    };
  });
  ipcMain.handle('recovery:check', () =>
    runRecoveryAction(async () => {
      await updateService.checkForUpdates();
    })
  );
  ipcMain.handle('recovery:download', () =>
    runRecoveryAction(() => updateService.downloadUpdate())
  );
  ipcMain.handle('recovery:install', () =>
    runRecoveryAction(() => {
      clearBootFailureMarker();
      updateService.quitAndInstall();
    })
  );
  ipcMain.handle('recovery:restart', () => {
    app.relaunch();
    app.exit(0);
  });
  ipcMain.handle('recovery:try-normal-start', () => {
    clearBootFailureMarker();
    app.relaunch();
    app.exit(0);
  });
  ipcMain.handle('recovery:open-logs', async () => {
    const logFilePath = getLogFilePath();
    if (logFilePath) {
      shell.showItemInFolder(logFilePath);
      return;
    }
    await shell.openPath(dirname(join(app.getPath('userData'), 'logs', 'emdash.log')));
  });
  ipcMain.handle('recovery:quit', () => app.quit());
}

async function runRecoveryAction(action: () => void | Promise<void>) {
  try {
    await action();
    return { success: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn('Recovery action failed', { error });
    return { success: false as const, error: message };
  }
}
