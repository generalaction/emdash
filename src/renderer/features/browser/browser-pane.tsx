import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDevServers } from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import { normalizeBrowserUrl } from '@shared/browser';
import { browserControlsRegistry } from './browser-controls-registry';
import { decideBrowserReload } from './browser-navigation-controls';
import { browserSessionStore } from './browser-session-store';
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

  const attachWebview = (node: Element | null) => {
    const next = node as BrowserWebviewElement | null;
    if (webviewRef.current === next) return;
    webviewRef.current = next;
    setWebviewElement(next);
    setAdapter(null);
  };

  useEffect(() => {
    if (!sessionBrowserId || !webviewElement) return;
    return bindBrowserWebviewEvents(sessionBrowserId, webviewElement, {
      onDomReady: () => {
        if (webviewRef.current === webviewElement) {
          setAdapter(createBrowserWebviewAdapter(webviewElement));
        }
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
        devServerUrls={devServers.urls}
        onNavigate={navigateTo}
        onReload={reload}
        onFocusUrl={(focus) => {
          focusUrlRef.current = focus;
        }}
      />
      <div className="min-h-0 flex-1 bg-background">
        {webviewProps && isRegistered ? (
          <webview
            key={`${webviewMount?.browserId ?? 'browser'}:${webviewMount?.revision ?? 0}`}
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
