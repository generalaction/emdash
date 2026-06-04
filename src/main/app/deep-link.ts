import { app, type BrowserWindow } from 'electron';
import { events } from '@main/lib/events';
import { APP_NAME_LOWER } from '@shared/app-identity';
import { deepLinkChannel } from '@shared/events/appEvents';
import {
  findDeepLinkInArgv as findDeepLinkInArgvWithScheme,
  isDeepLinkUrl,
} from './deep-link-utils';
import { getMainWindow } from './window';

export const DEEP_LINK_SCHEME = APP_NAME_LOWER;

let pendingUrl: string | null = null;

export function registerDeepLinkProtocol(): void {
  if (process.defaultApp) {
    const scriptPath = process.argv[1];
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [scriptPath]);
    return;
  }

  app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
}

export function findDeepLinkInArgv(argv: string[]): string | null {
  return findDeepLinkInArgvWithScheme(argv, DEEP_LINK_SCHEME);
}

export function handleDeepLinkUrl(url: string): void {
  if (!isDeepLinkUrl(url, DEEP_LINK_SCHEME)) return;

  const win = getMainWindow();
  if (win?.isMinimized()) win.restore();
  win?.focus();

  if (!win || win.isDestroyed() || win.webContents.isLoadingMainFrame()) {
    pendingUrl = url;
    return;
  }

  events.emit(deepLinkChannel, { url });
}

export function flushPendingDeepLink(): void {
  const url = pendingUrl;
  if (!url) return;
  pendingUrl = null;
  events.emit(deepLinkChannel, { url });
}

export function attachDeepLinkFlush(win: BrowserWindow): void {
  win.webContents.once('did-finish-load', () => {
    flushPendingDeepLink();
  });
}
