import { BROWSER_DEFAULT_URL } from '@shared/browser';
import { browserDiagnosticsStore } from './browser-diagnostics-store';
import { browserSessionStore } from './browser-session-store';
import type { BrowserWebviewElement } from './browser-webview-types';

export function bindBrowserWebviewEvents(
  browserId: string,
  webview: BrowserWebviewElement,
  options: { onDomReady?: () => void } = {}
): () => void {
  let isDomReady = false;
  let historySyncTimer: ReturnType<typeof setTimeout> | undefined;

  const syncHistoryState = () => {
    if (!isDomReady) return;
    browserSessionStore.updateSession(browserId, {
      currentUrl: webview.getURL() || BROWSER_DEFAULT_URL,
      title: webview.getTitle(),
      canGoBack: webview.canGoBack(),
      canGoForward: webview.canGoForward(),
    });
  };

  const scheduleHistoryStateSync = () => {
    if (historySyncTimer) clearTimeout(historySyncTimer);
    historySyncTimer = setTimeout(() => {
      historySyncTimer = undefined;
      syncHistoryState();
    }, 0);
  };

  const onDomReady = () => {
    isDomReady = true;
    syncHistoryState();
    options.onDomReady?.();
  };

  const onStartLoading = () => {
    browserSessionStore.updateSession(browserId, {
      isLoading: true,
      loadError: null,
    });
  };

  const onStopLoading = () => {
    if (!isDomReady) return;
    browserSessionStore.updateSession(browserId, {
      isLoading: false,
      currentUrl: webview.getURL() || BROWSER_DEFAULT_URL,
      title: webview.getTitle(),
      canGoBack: webview.canGoBack(),
      canGoForward: webview.canGoForward(),
    });
    scheduleHistoryStateSync();
  };

  const onNavigate = (event: { url: string }) => {
    if (!isDomReady) return;
    browserSessionStore.updateSession(browserId, {
      currentUrl: event.url,
      canGoBack: webview.canGoBack(),
      canGoForward: webview.canGoForward(),
      loadError: null,
    });
    scheduleHistoryStateSync();
  };

  const onFailLoad = (event: {
    errorCode: number;
    errorDescription: string;
    validatedURL: string;
  }) => {
    if (event.errorCode === -3) return;
    browserSessionStore.updateSession(browserId, {
      isLoading: false,
      loadError: {
        code: event.errorCode,
        description: event.errorDescription,
        url: event.validatedURL,
      },
    });
    browserDiagnosticsStore.append({
      browserId,
      level: 'error',
      source: 'navigation',
      message: event.errorDescription,
      url: event.validatedURL,
    });
  };

  const onConsoleMessage = (event: {
    level: number;
    message: string;
    line: number;
    sourceId: string;
  }) => {
    if (!shouldRecordConsoleDiagnostic(event)) return;
    browserDiagnosticsStore.append({
      browserId,
      level: consoleLevelToDiagnosticsLevel(event.level),
      source: 'console',
      message: event.message,
      url: event.sourceId,
      line: event.line,
    });
  };

  const onTitle = (event: { title: string }) => {
    browserSessionStore.updateSession(browserId, { title: event.title });
  };

  const onFavicon = (event: { favicons: string[] }) => {
    browserSessionStore.updateSession(browserId, { faviconUrl: event.favicons[0] });
  };

  webview.addEventListener('dom-ready', onDomReady);
  webview.addEventListener('did-start-loading', onStartLoading);
  webview.addEventListener('did-stop-loading', onStopLoading);
  webview.addEventListener('did-navigate', onNavigate);
  webview.addEventListener('did-navigate-in-page', onNavigate);
  webview.addEventListener('did-fail-load', onFailLoad);
  webview.addEventListener('console-message', onConsoleMessage);
  webview.addEventListener('page-title-updated', onTitle);
  webview.addEventListener('page-favicon-updated', onFavicon);

  return () => {
    if (historySyncTimer) clearTimeout(historySyncTimer);
    webview.removeEventListener('dom-ready', onDomReady);
    webview.removeEventListener('did-start-loading', onStartLoading);
    webview.removeEventListener('did-stop-loading', onStopLoading);
    webview.removeEventListener('did-navigate', onNavigate);
    webview.removeEventListener('did-navigate-in-page', onNavigate);
    webview.removeEventListener('did-fail-load', onFailLoad);
    webview.removeEventListener('console-message', onConsoleMessage);
    webview.removeEventListener('page-title-updated', onTitle);
    webview.removeEventListener('page-favicon-updated', onFavicon);
  };
}

function consoleLevelToDiagnosticsLevel(level: number) {
  if (level >= 3) return 'error';
  if (level === 2) return 'warning';
  return 'info';
}

function shouldRecordConsoleDiagnostic(event: { message: string; sourceId: string }): boolean {
  if (!event.sourceId.startsWith('node:electron/')) return true;
  return !event.message.includes('Electron Security Warning');
}
