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

  ipcMain.handle(
    'settings:update',
    async (
      _event,
      partial: Partial<{
        repository: { branchTemplate?: string; pushOnCreate?: boolean };
        projectPrep: { autoInstallOnOpenInEditor?: boolean };
      }>
    ) => {
      try {
        const settings = updateAppSettings((partial as Partial<AppSettings>) || {});
        return { success: true, settings };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }
  );
}
