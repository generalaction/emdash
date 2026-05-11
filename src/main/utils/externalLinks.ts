import { shell, type BrowserWindow } from 'electron';

/**
 * Ensure any external HTTP(S) links open in the user's default browser
 * rather than inside the Electron window. Keeps app navigation scoped
 * to our renderer while preserving expected link behavior.
 */
export function registerExternalLinkHandlers(win: BrowserWindow, isDev: boolean) {
  const wc = win.webContents;

  const isInternalAppUrl = (url: string) => {
    if (isDev) {
      const rendererUrl = process.env.ELECTRON_RENDERER_URL;
      // In dev, only treat URLs from the explicitly-configured renderer origin
      // as internal. If ELECTRON_RENDERER_URL is unset, fail closed.
      return !!rendererUrl && url.startsWith(rendererUrl);
    }
    return /^http:\/\/(127\.0\.0\.1|localhost):\d+(?:\/|$)/i.test(url);
  };

  // Handle window.open and target="_blank".
  // Default-deny: only http(s) external URLs are handed off to the OS browser,
  // and only same-origin internal URLs may open a new BrowserWindow. Any other
  // scheme (file:, data:, javascript:, custom app schemes, …) is rejected so
  // a rendered link can never escape the app:// origin into a privileged
  // BrowserWindow context.
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      if (isInternalAppUrl(url)) return { action: 'allow' };
      void shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });

  // Intercept navigations that would leave the app. Block anything that isn't
  // an explicitly-recognised internal URL — including file://, custom schemes,
  // and unknown http(s) origins — so a link in renderer content can't replace
  // the app:// origin with file:// and pivot to preload-exposed APIs.
  wc.on('will-navigate', (event, url) => {
    if (isInternalAppUrl(url)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
  });
}
