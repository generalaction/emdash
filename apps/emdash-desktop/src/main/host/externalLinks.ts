import { shell, type BrowserWindow } from 'electron';
import { desktopHostEvents } from '@core/features/workbench/node';
import { isInternalAppUrl } from '@main/host/external-link-policy';
import { getMainWindow } from '@main/host/window';
import { log } from '@main/lib/logger';

/**
 * Ensure any external HTTP(S) links open in the user's default browser
 * rather than inside the Electron window. Keeps app navigation scoped
 * to our renderer while preserving expected link behavior.
 */
function requestExternalLinkOpen(url: string) {
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    desktopHostEvents.emit(undefined, { type: 'external-link-open-requested', url });
    return;
  }

  log.warn('External link request had no main window; opening directly', { url });
  shell.openExternal(url).catch((error: unknown) => {
    log.warn('Failed to open external link without main window', { url, error });
  });
}

/**
 * `rendererUrl` is the URL the main window was loaded from; only navigations to that origin
 * stay in-window. Local dev servers on other localhost ports are external links like any other.
 */
export function registerExternalLinkHandlers(win: BrowserWindow, rendererUrl: string) {
  const wc = win.webContents;

  // Handle window.open and target="_blank"
  wc.setWindowOpenHandler(({ url }) => {
    if (!isInternalAppUrl(url, rendererUrl) && /^https?:\/\//i.test(url)) {
      requestExternalLinkOpen(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Intercept navigations that would leave the app
  wc.on('will-navigate', (event, url) => {
    if (!isInternalAppUrl(url, rendererUrl) && /^https?:\/\//i.test(url)) {
      event.preventDefault();
      requestExternalLinkOpen(url);
    }
  });
}
