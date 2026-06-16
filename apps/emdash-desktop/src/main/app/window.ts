import { join } from 'node:path';
import { BrowserWindow } from 'electron';
import devIcon from '@/assets/images/emdash/emdash-dev.png?asset';
import { browserWebContentsRegistry } from '@main/core/browser/browser-webcontents-registry';
import {
  hardenBrowserWebviewPreferences,
  stripBrowserWebviewParams,
  validateBrowserWebviewAttach,
} from '@main/core/browser/webview-security';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { registerExternalLinkHandlers } from '@main/utils/externalLinks';
import { PRODUCT_NAME } from '@shared/app-identity';
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
    show: false,
  });

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

  // Cleanup reference on close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
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
    const browserId = browserWebContentsRegistry.getBrowserIdForWebContents(webContents);
    if (!browserId) {
      webContents.close();
      return;
    }
    browserWebContentsRegistry.attachWebContents(browserId, webContents);
  });
}
