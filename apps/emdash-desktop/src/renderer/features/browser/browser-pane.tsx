import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDevServers } from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import { normalizeBrowserUrl, normalizeBrowserZoomFactor } from '@shared/browser';
import { browserControlsRegistry } from './browser-controls-registry';
import { decideBrowserReload } from './browser-navigation-controls';
import { browserSessionStore } from './browser-session-store';
import { BrowserStartPage } from './browser-start-page';
import { BrowserToolbar } from './browser-toolbar';
import { bindBrowserWebviewEvents } from './browser-webview-events';
import {
  createBrowserWebviewAdapter,
  type BrowserWebviewAdapter,
  type BrowserWebviewElement,
} from './browser-webview-types';

const WEBVIEW_ALLOW_POPUPS_ATTRIBUTE = 'true' as unknown as boolean;

export const BrowserPane = observer(function BrowserPane({ browserId }: { browserId: string }) {
  const session = browserSessionStore.getSession(browserId);
  const devServers = useDevServers();
  const webviewRef = useRef<BrowserWebviewElement | null>(null);
  const focusUrlRef = useRef<() => void>(() => {});
  const pendingUrlRef = useRef<string | null>(null);
  const [adapter, setAdapter] = useState<BrowserWebviewAdapter | null>(null);
  const [webviewElement, setWebviewElement] = useState<BrowserWebviewElement | null>(null);
  const [webviewMount, setWebviewMount] = useState<{
    browserId: string;
    partition: string;
    src: string;
    revision: number;
  } | null>(null);
  const [isRegistered, setIsRegistered] = useState(false);
  const sessionBrowserId = session?.browserId;
  const sessionPartition = session?.partition;
  const showStartPage = session?.currentUrl === 'about:blank' && !session.isLoading;

  useEffect(() => {
    if (!sessionBrowserId || !sessionPartition || !session) {
      setWebviewMount(null);
      return;
    }
    setWebviewMount((current) => {
      if (current?.browserId === sessionBrowserId && current.partition === sessionPartition) {
        return current;
      }
      return {
        browserId: sessionBrowserId,
        partition: sessionPartition,
        src: session.currentUrl,
        revision: 0,
      };
    });
  }, [session, sessionBrowserId, sessionPartition]);

  useEffect(() => {
    if (!sessionBrowserId || !sessionPartition) return;
    let disposed = false;
    setIsRegistered(false);
    void rpc.browser
      .registerSession({
        browserId: sessionBrowserId,
        partition: sessionPartition,
      })
      .then((result) => {
        if (!disposed) setIsRegistered(result.success);
      });
    return () => {
      disposed = true;
      setIsRegistered(false);
      void rpc.browser.setActiveBrowser(null);
    };
  }, [sessionBrowserId, sessionPartition]);

  useEffect(() => {
    if (!sessionBrowserId || adapter === null) return;
    void rpc.browser.setActiveBrowser(sessionBrowserId);
  }, [adapter, sessionBrowserId]);

  const webviewProps = useMemo(() => {
    if (!webviewMount) return null;
    return {
      src: webviewMount.src,
      partition: webviewMount.partition,
      allowpopups: WEBVIEW_ALLOW_POPUPS_ATTRIBUTE,
      'data-browser-id': webviewMount.browserId,
    };
  }, [webviewMount]);

  const loadUrl = useCallback(
    (url: string) => {
      if (!sessionBrowserId) return;
      pendingUrlRef.current = url;
      browserSessionStore.updateSession(sessionBrowserId, {
        currentUrl: url,
        faviconUrl: null,
        isLoading: true,
        loadError: null,
      });
      if (adapter) {
        pendingUrlRef.current = null;
        void adapter.loadUrl(url);
        return;
      }
      setWebviewMount((current) => {
        if (!current) return current;
        return {
          ...current,
          src: url,
          revision: current.revision + 1,
        };
      });
    },
    [adapter, sessionBrowserId]
  );

  const navigateTo = useCallback(
    (url: string): boolean => {
      const normalized = normalizeBrowserUrl(url);
      if (!normalized.ok) return false;
      loadUrl(normalized.url);
      return true;
    },
    [loadUrl]
  );

  const goBack = useCallback(() => {
    if (!adapter?.canGoBack()) return;
    adapter.goBack();
  }, [adapter]);

  const goForward = useCallback(() => {
    if (!adapter?.canGoForward()) return;
    adapter.goForward();
  }, [adapter]);

  const reload = useCallback(() => {
    if (!session) return;
    const decision = decideBrowserReload({
      currentUrl: session.currentUrl,
      isLoading: session.isLoading,
      hasAdapter: adapter !== null,
    });
    if (decision.kind === 'reload-adapter') adapter?.reload();
    if (decision.kind === 'stop-adapter') adapter?.stop();
    if (decision.kind === 'retry-url') loadUrl(decision.url);
  }, [adapter, loadUrl, session]);

  const forceReload = useCallback(() => {
    if (adapter) {
      adapter.reloadIgnoringCache();
      return;
    }
    reload();
  }, [adapter, reload]);

  const setZoomFactor = useCallback(
    (factor: number) => {
      if (!sessionBrowserId) return;
      const zoomFactor = normalizeBrowserZoomFactor(factor);
      browserSessionStore.updateSession(sessionBrowserId, {
        zoomFactor,
      });
      adapter?.setZoomFactor(zoomFactor);
    },
    [adapter, sessionBrowserId]
  );

  // Must stay referentially stable: React re-invokes inline ref callbacks with
  // null + node on every render, which would wipe the adapter until the next
  // dom-ready and break everything adapter-backed (zoom, stop, force reload).
  const attachWebview = useCallback((node: Element | null) => {
    const next = node as BrowserWebviewElement | null;
    if (webviewRef.current === next) return;
    webviewRef.current = next;
    setWebviewElement(next);
    setAdapter(null);
  }, []);

  useEffect(() => {
    if (!sessionBrowserId || !webviewElement) return;
    return bindBrowserWebviewEvents(sessionBrowserId, webviewElement, {
      onDomReady: () => {
        if (webviewRef.current !== webviewElement) return;
        // Browsers can share profile partitions, so the main process cannot infer
        // which browser a webview belongs to; bind it explicitly.
        void rpc.browser.bindWebContents({
          browserId: sessionBrowserId,
          webContentsId: webviewElement.getWebContentsId(),
        });
        setAdapter(createBrowserWebviewAdapter(webviewElement));
      },
    });
  }, [sessionBrowserId, webviewElement]);

  useEffect(() => {
    if (!adapter || !pendingUrlRef.current) return;
    const pendingUrl = pendingUrlRef.current;
    pendingUrlRef.current = null;
    void adapter.loadUrl(pendingUrl);
  }, [adapter]);

  useEffect(() => {
    if (!sessionBrowserId) return;
    return browserControlsRegistry.register(sessionBrowserId, {
      adapter,
      focusUrl: () => focusUrlRef.current(),
    });
  }, [adapter, sessionBrowserId]);

  if (!session) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-background text-sm text-foreground-muted">
        Browser session unavailable
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <BrowserToolbar
        session={session}
        adapter={adapter}
        autoFocusUrl={showStartPage}
        onNavigate={navigateTo}
        onGoBack={goBack}
        onGoForward={goForward}
        onReload={reload}
        onForceReload={forceReload}
        onSetZoomFactor={setZoomFactor}
        onFocusUrl={(focus) => {
          focusUrlRef.current = focus;
        }}
      />
      <div className="emlight min-h-0 flex-1 bg-background">
        {showStartPage ? (
          <BrowserStartPage devServerUrls={devServers.urls} onOpenUrl={navigateTo} />
        ) : webviewProps && isRegistered ? (
          <webview
            key={`${webviewMount?.browserId ?? 'browser'}:${webviewMount?.partition ?? 'partition'}:${webviewMount?.revision ?? 0}`}
            ref={attachWebview}
            {...webviewProps}
            className="h-full w-full bg-background"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-foreground-muted">
            Preparing browser session
          </div>
        )}
      </div>
    </div>
  );
});
