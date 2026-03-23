import { app, BrowserWindow } from 'electron';
import { createMainWindow, getMainWindow } from './window';
import { createTray, setMainWindowRef, destroyTray } from './tray';

export function registerAppLifecycle() {
  app.whenReady().then(() => {
    const win = createMainWindow();
    setMainWindowRef(win);
    createTray();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const win = createMainWindow();
      setMainWindowRef(win);
    } else {
      const win = getMainWindow();
      if (win) {
        win.show();
        win.focus();
      }
    }
  });
}
