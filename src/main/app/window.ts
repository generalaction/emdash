import { BrowserWindow } from 'electron';
import { join } from 'path';
import { isDev } from '../utils/dev';
import { registerExternalLinkHandlers } from '../utils/externalLinks';

let mainWindow: BrowserWindow | null = null;

export function createMainWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // __dirname here resolves to dist/main/app at runtime
      // preload is emitted to dist/main/preload.js
      preload: join(__dirname, '..', 'preload.js'),
    },
    titleBarStyle: 'hiddenInset',
    show: false,
  });

  if (isDev) {
    const devPort = Number(process.env.VITE_PORT || process.env.PORT || '3000');
    try {
      mainWindow.loadURL(`http://localhost:${devPort}`);
    } catch (_e) {
      mainWindow.loadURL('http://localhost:3000');
    }
  } else {
    // renderer build outputs to dist/renderer
    mainWindow.loadFile(join(__dirname, '..', '..', 'renderer', 'index.html'));
  }

  // Route external links to the user’s default browser
  registerExternalLinkHandlers(mainWindow, isDev);

  // Show when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Cleanup reference on close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
