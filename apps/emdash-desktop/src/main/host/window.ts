import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import devIcon from '@/assets/images/emdash/emdash-dev.png?asset';
import { browserWebContentsRegistry } from '@main/host/browser/browser-webcontents-registry';
import {
  hardenBrowserWebviewPreferences,
  stripBrowserWebviewParams,
  validateBrowserWebviewAttach,
} from '@main/host/browser/webview-security';
import { events } from '@main/host/events';
import { registerExternalLinkHandlers } from '@main/host/externalLinks';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { PRODUCT_NAME } from '@shared/app-identity';
import { windowMaximizeChangedChannel } from '@shared/events/appEvents';
import { APP_ORIGIN } from './protocol';

let mainWindow: BrowserWindow | null = null;

export function createMainWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 700,
    minHeight: 500,
    title: PRODUCT_NAME,
    // In production, electron-builder injects the icon from the app bundle.
    ...(import.meta.env.DEV && { icon: devIcon }),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Required for ESM preload scripts (.mjs)
      sandbox: false,
      // Allow using <webview> in renderer for in‑app browser pane.
      // The webview runs in a separate process; nodeIntegration remains disabled.
      webviewTag: true,
      // __dirname resolves to out/main/ at runtime; preload is at out/preload/index.mjs
      preload: join(__dirname, '../preload/index.mjs'),
    },
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: { x: 10, y: 10 },
          acceptFirstMouse: true,
        }
      : {}),
    // Linux: go fully frameless and draw our own window controls in the
    // renderer (see WindowControls). Electron's native titleBarOverlay is
    // experimental/inconsistent across desktop environments, so we avoid it —
    // this mirrors how VSCode handles its custom title bar on Linux.
    ...(process.platform === 'linux' ? { frame: false } : {}),
    show: false,
  });

  if (process.platform !== 'darwin') {
    mainWindow.setMenuBarVisibility(false);
  }

  if (import.meta.env.DEV) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL!);
  } else {
    void mainWindow.loadURL(`${APP_ORIGIN}/index.html`);
  }

  // Route external links to the user’s default browser
  registerExternalLinkHandlers(mainWindow, import.meta.env.DEV);
  registerBrowserWebviewHandlers(mainWindow);

  // Show when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Track window focus for telemetry
  mainWindow.on('focus', () => {
    telemetryService.capture('app_window_focused');
    if (typeof mainWindow?.setWindowButtonVisibility === 'function') {
      mainWindow.setWindowButtonVisibility(true);
    }
    void telemetryService.checkAndReportDailyActiveUser();
  });

  mainWindow.on('blur', () => {
    telemetryService.capture('app_window_unfocused');
  });

  // Keep the renderer's custom window controls (Linux) in sync with the
  // actual maximize state so the maximize/restore icon stays correct.
  mainWindow.on('maximize', () => {
    events.emit(windowMaximizeChangedChannel, { maximized: true });
  });
  mainWindow.on('unmaximize', () => {
    events.emit(windowMaximizeChangedChannel, { maximized: false });
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

export function isAppFocused(): boolean {
  const windows = BrowserWindow.getAllWindows();
  return windows.some((window) => !window.isDestroyed() && window.isFocused());
}

export function focusAppFromNotification(): BrowserWindow | null {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return null;

  if (win.isMinimized()) win.restore();
  win.show();

  if (process.platform === 'darwin') {
    app.focus({ steal: true });
  } else {
    app.focus();
  }

  win.focus();
  return win;
}

function registerBrowserWebviewHandlers(win: BrowserWindow): void {
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    const validation = validateBrowserWebviewAttach(
      params,
      browserWebContentsRegistry.registeredPartitions
    );
    if (!validation.ok) {
      event.preventDefault();
      log.warn('Denied browser webview attachment', { reason: validation.reason });
      return;
    }

    hardenBrowserWebviewPreferences(webPreferences);
    stripBrowserWebviewParams(params);
  });

  win.webContents.on('did-attach-webview', (_event, webContents) => {
    if (!browserWebContentsRegistry.handleWebviewAttached(webContents)) {
      log.warn('Closed webview without a registered browser session');
    }
  });
}
