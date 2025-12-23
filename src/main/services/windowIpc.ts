import { ipcMain, BrowserWindow } from 'electron';

export function registerWindowIpc(): void {
  // Get the current fullscreen state of the main window
  ipcMain.handle('window:get-fullscreen-state', () => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    return mainWindow?.isFullScreen() || false;
  });
}
