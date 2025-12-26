import { ipcMain } from 'electron';
import { getMainWindow } from '../app/window';

export function registerWindowIpc(): void {
  // Get the current fullscreen state of the main window
  ipcMain.handle('window:get-fullscreen-state', () => {
    const mainWindow = getMainWindow();
    return mainWindow?.isFullScreen() || false;
  });
}
