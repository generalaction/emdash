import { ipcMain, BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { AppSettings, getAppSettings, updateAppSettings } from '../settings';

export function registerSettingsIpc() {
  ipcMain.handle('settings:get', async () => {
    try {
      const settings = getAppSettings();
      return { success: true, settings };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('settings:update', async (_event: IpcMainInvokeEvent, partial: Partial<AppSettings>) => {
    try {
      const settings = updateAppSettings(partial || {});

      // Notify all renderer processes about settings update
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        win.webContents.send('settings-updated', settings);
      }

      return { success: true, settings };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });
}
