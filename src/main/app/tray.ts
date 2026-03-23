import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron';
import { join } from 'path';
import { isDev } from '../utils/dev';

let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;

export function setMainWindowRef(win: BrowserWindow | null) {
  mainWindow = win;
}

export function createTray(): Tray | null {
  if (tray) return tray;

  // Create tray icon
  const iconPath = isDev
    ? join(__dirname, '..', '..', '..', 'src', 'assets', 'images', 'emdash', 'emdash_logo.png')
    : join(process.resourcesPath || '', 'icon.png');

  // Use a simple 16x16 icon for tray
  let trayIcon: Electron.NativeImage;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      // Fallback: create empty icon
      trayIcon = nativeImage.createEmpty();
    }
    // Resize for tray
    trayIcon = trayIcon.resize({ width: 16, height: 16 });
  } catch {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Emdash');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Emdash',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          const { createMainWindow } = require('./window');
          createMainWindow();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Emdash',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Double-click to show window
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  return tray;
}

export function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
