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
    // In production, compiled main files are under dist/main/main/**
    // Renderer build outputs to dist/renderer/index.html (sibling of dist/main)
    // __dirname here resolves to dist/main/main/app, so we go up 3 levels.
    // renderer build outputs to dist/renderer
    // __dirname resolves to dist/main/main/app at runtime; go up to dist and into renderer
    mainWindow.loadFile(join(__dirname, '..', '..', '..', 'renderer', 'index.html'));
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
