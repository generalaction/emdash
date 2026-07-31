import { join } from 'node:path';
import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import devIcon from '@/assets/images/emdash/emdash-dev.png?asset';
import { browserWebContentsRegistry } from '@main/core/browser/browser-webcontents-registry';
import {
  hardenBrowserWebviewPreferences,
  stripBrowserWebviewParams,
  validateBrowserWebviewAttach,
} from '@main/core/browser/webview-security';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { registerExternalLinkHandlers } from '@main/utils/externalLinks';
import { PRODUCT_NAME } from '@shared/app-identity';
import type { Theme } from '@shared/core/app-settings';
import { windowMaximizeChangedChannel } from '@shared/events/appEvents';
import { APP_ORIGIN } from './protocol';
import {
  createDebouncedSaver,
  readWindowStateFile,
  resolveWindowState,
  WINDOW_STATE_FILE_NAME,
  writeWindowStateFile,
  type WindowState,
} from './window-state';

const DEFAULT_WINDOW_SIZE = { width: 1400, height: 900 };
const MIN_WINDOW_SIZE = { width: 700, height: 500 };

let mainWindow: BrowserWindow | null = null;

export function applyNativeTheme(theme: Theme): void {
  if (process.platform !== 'win32') return;
  nativeTheme.themeSource = theme === 'emdark' ? 'dark' : theme === 'emlight' ? 'light' : 'system';
}

// Resolved per call rather than at module load: the userData path is only
// final once app identity has been configured.
function windowStateFilePath(): string {
  return join(app.getPath('userData'), WINDOW_STATE_FILE_NAME);
}

export function createMainWindow(): BrowserWindow {
  const restored = resolveWindowState({
    raw: readWindowStateFile(windowStateFilePath()),
    workAreas: screen.getAllDisplays().map((display) => display.workArea),
    defaultSize: DEFAULT_WINDOW_SIZE,
    minSize: MIN_WINDOW_SIZE,
  });

  mainWindow = new BrowserWindow({
    ...restored.creationBounds,
    minWidth: MIN_WINDOW_SIZE.width,
    minHeight: MIN_WINDOW_SIZE.height,
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

  // Applied while the window is still hidden so it never shows at the
  // windowed size first and then jumps.
  if (restored.maximized) mainWindow.maximize();
  if (restored.fullScreen) mainWindow.setFullScreen(true);
  trackWindowState(mainWindow);

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

/**
 * Persist geometry as the user changes it, so the next launch opens where the
 * last one left off.
 *
 * `getNormalBounds` is the rectangle to save in every mode: for a maximized or
 * fullscreen window it reports the one the window returns to, which is what a
 * later un-maximize needs.
 */
function trackWindowState(win: BrowserWindow): void {
  const filePath = windowStateFilePath();
  const saver = createDebouncedSaver<WindowState>((state) => {
    writeWindowStateFile(filePath, state);
  });

  const capture = (): void => {
    if (win.isDestroyed()) return;
    saver.update({
      ...win.getNormalBounds(),
      maximized: win.isMaximized(),
      fullScreen: win.isFullScreen(),
    });
  };

  win.on('resize', capture);
  win.on('move', capture);
  win.on('maximize', capture);
  win.on('unmaximize', capture);
  win.on('enter-full-screen', capture);
  win.on('leave-full-screen', capture);

  // The final state matters most and arrives last, so close takes the pending
  // write rather than waiting out a debounce the window will not survive.
  win.on('close', () => {
    capture();
    saver.flush();
  });
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
