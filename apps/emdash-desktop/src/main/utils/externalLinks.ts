import { shell, type BrowserWindow } from 'electron';
import { getMainWindow } from '@main/app/window';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { externalLinkOpenRequestedChannel } from '@shared/events/appEvents';

/**
 * Ensure any external HTTP(S) links open in the user's default browser
 * rather than inside the Electron window. Keeps app navigation scoped
 * to our renderer while preserving expected link behavior.
 */
function requestExternalLinkOpen(url: string) {
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    events.emit(externalLinkOpenRequestedChannel, { url });
    return;
  }

  log.warn('External link request had no main window; opening directly', { url });
  shell.openExternal(url).catch((error: unknown) => {
    log.warn('Failed to open external link without main window', { url, error });
  });
}

export function registerExternalLinkHandlers(win: BrowserWindow, isDev: boolean) {
  const wc = win.webContents;

  const isInternalAppUrl = (url: string) => {
    if (isDev) return url.startsWith(process.env.ELECTRON_RENDERER_URL!);
    return url.startsWith('file://') || /^http:\/\/(127\.0\.0\.1|localhost):\d+(?:\/|$)/i.test(url);
  };

  // Handle window.open and target="_blank"
  wc.setWindowOpenHandler(({ url }) => {
    if (!isInternalAppUrl(url) && /^https?:\/\//i.test(url)) {
      requestExternalLinkOpen(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Intercept navigations that would leave the app
  wc.on('will-navigate', (event, url) => {
    if (!isInternalAppUrl(url) && /^https?:\/\//i.test(url)) {
      event.preventDefault();
      requestExternalLinkOpen(url);
    }
  });
}
