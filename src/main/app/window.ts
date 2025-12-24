import { BrowserWindow } from 'electron';
import { join } from 'path';
import { isDev } from '../utils/dev';
import { registerExternalLinkHandlers } from '../utils/externalLinks';
import { ensureRendererServer } from './staticServer';

let mainWindow: BrowserWindow | null = null;

export function createMainWindow(): BrowserWindow {
  // In development, resolve icon from src/assets
  // In production (packaged), electron-builder handles the icon
  const iconPath = isDev
    ? join(__dirname, '..', '..', '..', 'src', 'assets', 'images', 'emdash', 'emdash_logo.png')
    : undefined;

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 800,
    title: 'Emdash',
    ...(iconPath && { icon: iconPath }),
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

  // Track window focus for telemetry
  mainWindow.on('focus', () => {
    // Lazy import to avoid circular dependencies
    void import('../telemetry').then(({ capture }) => {
      void capture('app_window_focused');
    });
  });

  // Cleanup reference on close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Notify renderer when entering/leaving native fullscreen (for macOS titlebar padding)
  mainWindow.on('enter-full-screen', function () {
    this.webContents.send('window:fullscreen-changed', true);
  });

  mainWindow.on('leave-full-screen', function () {
    this.webContents.send('window:fullscreen-changed', false);
  });

  return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
