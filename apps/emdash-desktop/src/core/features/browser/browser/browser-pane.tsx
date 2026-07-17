import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePreviewServers } from '@core/features/tasks/browser/task-view-context';
import { usePaneContext } from '@core/features/workbench/browser/tabs/pane-context';
import { normalizeBrowserUrl, normalizeBrowserZoomFactor } from '@core/primitives/browser/api';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { Button } from '@renderer/lib/ui/button';
import { browserControlsRegistry } from './browser-controls-registry';
import {
  browserLoadErrorCode,
  describeBrowserLoadError,
  type BrowserLoadErrorPresentation,
} from './browser-load-error';
import { decideBrowserReload } from './browser-navigation-controls';
import { browserSessionStore } from './browser-session-store';
import { BrowserStartPage } from './browser-start-page';
import { BrowserToolbar } from './browser-toolbar';
import { canOpenBrowserUrlExternally, openBrowserUrlExternally } from './browser-toolbar-actions';
import { bindBrowserWebviewEvents } from './browser-webview-events';
import {
  createBrowserWebviewAdapter,
  type BrowserWebviewAdapter,
  type BrowserWebviewElement,
} from './browser-webview-types';

const WEBVIEW_ALLOW_POPUPS_ATTRIBUTE = 'true' as unknown as boolean;

export const BrowserPane = observer(function BrowserPane({
  browserId,
  visible,
}: {
  browserId: string;
  visible: boolean;
}) {
  const session = browserSessionStore.getSession(browserId);
  const { pane } = usePaneContext();
  const previewServers = usePreviewServers();
  const webviewRef = useRef<BrowserWebviewElement | null>(null);
  const focusUrlRef = useRef<() => void>(() => {});
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
  const loadError = session && !session.isLoading ? session.loadError : undefined;
  const loadErrorUrl = loadError ? (loadError.url ?? session?.currentUrl ?? '') : '';
  const loadErrorPresentation = useMemo<BrowserLoadErrorPresentation | undefined>(
    () => (loadError ? describeBrowserLoadError(loadError, loadErrorUrl) : undefined),
    [loadError, loadErrorUrl]
  );
  const canOpenLoadErrorExternal = useMemo(
    () => (loadError ? canOpenBrowserUrlExternally(loadErrorUrl) : false),
    [loadError, loadErrorUrl]
  );

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
    void getDesktopWireClient()
      .then((client) =>
        client.browser.registerSession({
          browserId: sessionBrowserId,
          partition: sessionPartition,
        })
      )
      .then((result) => {
        if (!disposed) setIsRegistered(result.success);
      });
    return () => {
      disposed = true;
      setIsRegistered(false);
    };
  }, [sessionBrowserId, sessionPartition]);

  useEffect(() => {
    return () => {
      void getDesktopWireClient().then((client) =>
        client.browser.setActiveBrowser({ browserId: null })
      );
    };
  }, []);

  useEffect(() => {
    if (!visible || !sessionBrowserId || adapter === null) return;
    void getDesktopWireClient().then((client) =>
      client.browser.setActiveBrowser({ browserId: sessionBrowserId })
    );
  }, [adapter, sessionBrowserId, visible]);

  useEffect(() => {
    if (!visible || !sessionBrowserId) return;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void getDesktopWireClient().then(async (client) => {
      const nextUnsubscribe = await client.host.events.subscribe(undefined, {
        onEvent: (event) => {
          if (
            event.type !== 'tab-navigation-shortcut' ||
            event.source.browserId !== sessionBrowserId
          ) {
            return;
          }
          if (event.direction === 'next') pane.setNextTabActive();
          else pane.setPreviousTabActive();
        },
        onGap: () => {},
      });
      if (disposed) nextUnsubscribe();
      else unsubscribe = nextUnsubscribe;
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [sessionBrowserId, pane, visible]);

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
      browserSessionStore.updateSession(sessionBrowserId, {
        currentUrl: url,
        faviconUrl: null,
        isLoading: true,
        loadError: null,
      });
      if (adapter) {
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
        void getDesktopWireClient().then((client) =>
          client.browser.bindWebContents({
            browserId: sessionBrowserId,
            webContentsId: webviewElement.getWebContentsId(),
          })
        );
        setAdapter(createBrowserWebviewAdapter(webviewElement));
      },
    });
  }, [sessionBrowserId, webviewElement]);

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
        {loadError && loadErrorPresentation ? (
          <BrowserLoadErrorView
            url={loadErrorUrl}
            presentation={loadErrorPresentation}
            code={browserLoadErrorCode(loadError)}
            canOpenExternal={canOpenLoadErrorExternal}
            onReload={reload}
            onOpenExternal={() => openBrowserUrlExternally(loadErrorUrl)}
          />
        ) : showStartPage ? (
          <BrowserStartPage devServerUrls={previewServers.urls} onOpenUrl={navigateTo} />
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

function BrowserLoadErrorView({
  presentation,
  code,
  url,
  canOpenExternal,
  onReload,
  onOpenExternal,
}: {
  presentation: BrowserLoadErrorPresentation;
  code: string | null;
  url: string;
  canOpenExternal: boolean;
  onReload: () => void;
  onOpenExternal: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-auto p-8">
      <div className="flex max-w-sm flex-col items-center gap-2 text-center">
        <h1 className="text-base font-medium text-foreground">{presentation.heading}</h1>
        <p className="text-sm text-foreground-muted" title={url}>
          {presentation.detail}
          {code && <span className="text-foreground-tertiary-muted"> ({code})</span>}
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onReload}>
            Reload
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canOpenExternal}
            onClick={onOpenExternal}
          >
            Open externally
          </Button>
        </div>
      </div>
    </div>
  );
}
