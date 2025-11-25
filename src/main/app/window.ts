import { BrowserWindow } from 'electron';
import { join } from 'path';
import { isDev } from '../utils/dev';
import { registerExternalLinkHandlers } from '../utils/externalLinks';
import { ensureRendererServer } from './staticServer';

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
      // Allow using <webview> in the renderer for the in‑app browser pane.
      // The webview runs in a separate process; nodeIntegration remains disabled.
      webviewTag: true,
      // __dirname here resolves to dist/main/main/app at runtime (dev)
      // Preload is emitted to dist/main/main/preload.js
      preload: join(__dirname, '..', 'preload.js'),
    },
    titleBarStyle: 'hiddenInset',
    show: false,
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    // Serve renderer over an HTTP origin in production so embeds work.
    const rendererRoot = join(__dirname, '..', '..', '..', 'renderer');
    void ensureRendererServer(rendererRoot)
      .then((url: string) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL(url);
        }
      })
      .catch(() => {
        // Fallback to file load if server fails for any reason.
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadFile(join(rendererRoot, 'index.html'));
        }
      });
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
