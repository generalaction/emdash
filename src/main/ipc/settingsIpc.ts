import { ipcMain } from 'electron';
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

  ipcMain.handle('settings:update', async (_event, partial: Partial<AppSettings>) => {
    try {
      const settings = updateAppSettings(partial || {});
      return { success: true, settings };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });
}
