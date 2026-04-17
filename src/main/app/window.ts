import { BrowserWindow, app } from 'electron';
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
    minWidth: 700,
    minHeight: 500,
    title: 'Emdash',
    ...(iconPath && { icon: iconPath }),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Allow using <webview> in renderer for in‑app browser pane.
      // The webview runs in a separate process; nodeIntegration remains disabled.
      webviewTag: true,
      // __dirname here resolves to dist/main/main/app at runtime (dev)
      // Preload is emitted to dist/main/main/preload.js
      preload: join(__dirname, '..', 'preload.js'),
    },
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 16, y: 12 },
          // Enable Window Controls Overlay API so the renderer can use
          // env(titlebar-area-x) to position content after the traffic lights.
          titleBarOverlay: { height: 36 },
        }
      : { frame: false }),
    show: false,
  });

  if (isDev) {
    mainWindow.loadURL(`http://localhost:${process.env.EMDASH_DEV_PORT || 3000}`);
  } else {
    // Serve renderer over an HTTP origin in production so embeds work.
    const rendererRoot = join(app.getAppPath(), 'dist', 'renderer');
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
    void import('../telemetry').then(({ capture, checkAndReportDailyActiveUser }) => {
      void capture('app_window_focused');
      // Also check for daily active user when window gains focus
      checkAndReportDailyActiveUser();
    });
  });

  // Notify renderer of maximize/unmaximize for custom title bar
  if (process.platform !== 'darwin') {
    mainWindow.on('maximize', () => {
      mainWindow?.webContents.send('window:maximized');
    });
    mainWindow.on('unmaximize', () => {
      mainWindow?.webContents.send('window:unmaximized');
    });
  }

  // macOS trackpad two-finger swipe navigation (respects setting)
  if (process.platform === 'darwin') {
    mainWindow.on('swipe', (_event, direction) => {
      void import('../settings').then(({ getAppSettings }) => {
        const settings = getAppSettings();
        if (!settings.navigation?.trackpadSwipe) return;
        if (direction === 'left') {
          mainWindow?.webContents.send('navigate:back');
        } else if (direction === 'right') {
          mainWindow?.webContents.send('navigate:forward');
        }
      });
    });
  }

  // Windows/Linux mouse back/forward buttons via app-command
  if (process.platform !== 'darwin') {
    mainWindow.on('app-command', (_event, command) => {
      if (command === 'browser-backward') {
        mainWindow?.webContents.send('navigate:back');
      } else if (command === 'browser-forward') {
        mainWindow?.webContents.send('navigate:forward');
      }
    });
  }

  // Cleanup reference on close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
