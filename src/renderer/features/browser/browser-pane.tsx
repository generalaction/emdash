import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDevServers } from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import { browserControlsRegistry } from './browser-controls-registry';
import { BrowserDiagnosticsPanel } from './browser-diagnostics-panel';
import { browserSessionStore } from './browser-session-store';
import { BrowserToolbar } from './browser-toolbar';
import { bindBrowserWebviewEvents } from './browser-webview-events';
import {
  createBrowserWebviewAdapter,
  type BrowserWebviewAdapter,
  type BrowserWebviewElement,
} from './browser-webview-types';

export const BrowserPane = observer(function BrowserPane({ browserId }: { browserId: string }) {
  const session = browserSessionStore.getSession(browserId);
  const devServers = useDevServers();
  const webviewRef = useRef<BrowserWebviewElement | null>(null);
  const focusUrlRef = useRef<() => void>(() => {});
  const [adapter, setAdapter] = useState<BrowserWebviewAdapter | null>(null);
  const [webviewElement, setWebviewElement] = useState<BrowserWebviewElement | null>(null);
  const [isRegistered, setIsRegistered] = useState(false);
  const sessionBrowserId = session?.browserId;
  const sessionPartition = session?.partition;

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
    if (!session) return null;
    return {
      src: session.currentUrl,
      partition: session.partition,
      'data-browser-id': session.browserId,
    };
  }, [session]);

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
        onFocusUrl={(focus) => {
          focusUrlRef.current = focus;
        }}
      />
      <div className="min-h-0 flex-1 bg-background">
        {webviewProps && isRegistered ? (
          <webview ref={attachWebview} {...webviewProps} className="h-full w-full bg-background" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-foreground-muted">
            Preparing browser session
          </div>
        )}
      </div>
      <BrowserDiagnosticsPanel browserId={session.browserId} />
    </div>
  );
});
