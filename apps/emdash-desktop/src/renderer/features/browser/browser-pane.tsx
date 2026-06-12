import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDevServers } from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import { normalizeBrowserUrl, normalizeBrowserZoomFactor } from '@shared/browser';
import { BrowserAnnotationBar } from './browser-annotation-bar';
import { BrowserAnnotationOverlay } from './browser-annotation-overlay';
import { buildAnnotationPickerScript, parseAnnotationMessage } from './browser-annotation-script';
import { browserAnnotationStore } from './browser-annotation-store';
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
  const annotationChannelIdRef = useRef(crypto.randomUUID());
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
  const annotationState = browserAnnotationStore.get(browserId);

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
        if (webviewRef.current === webviewElement) {
          setAdapter(createBrowserWebviewAdapter(webviewElement));
        }
      },
    });
  }, [sessionBrowserId, webviewElement]);

  useEffect(() => {
    if (!webviewElement) return;
    const onConsoleMessage = (event: { message: string }) => {
      const parsed = parseAnnotationMessage(event.message, {
        channelId: annotationChannelIdRef.current,
      });
      if (!parsed) return;
      if (parsed.type === 'picked') {
        annotationState.startDraft(parsed.token, parsed.element, webviewElement.getURL());
      } else if (parsed.type === 'mode') {
        annotationState.setPicking(parsed.active);
      } else {
        annotationState.applyRects(parsed.rects);
      }
    };
    const onAnnotationNavigate = () => annotationState.handleNavigation();
    // SPA route changes keep the page context but may detach tracked elements
    // without a scroll — ask the picker for fresh rects so stale markers hide.
    const onInPageNavigate = () => {
      const draft = annotationState.cancelDraft();
      try {
        if (draft) {
          webviewElement
            .executeJavaScript(
              buildAnnotationPickerScript(
                { kind: 'untrack', token: draft.token },
                { channelId: annotationChannelIdRef.current }
              )
            )
            .catch(() => {});
        }
        webviewElement
          .executeJavaScript(
            buildAnnotationPickerScript(
              { kind: 'request-rects' },
              { channelId: annotationChannelIdRef.current }
            )
          )
          .catch(() => {});
      } catch {
        // WebViews can detach during tab transitions; rect refresh is best-effort.
      }
    };
    webviewElement.addEventListener('console-message', onConsoleMessage);
    webviewElement.addEventListener('did-navigate', onAnnotationNavigate);
    webviewElement.addEventListener('did-navigate-in-page', onInPageNavigate);
    return () => {
      webviewElement.removeEventListener('console-message', onConsoleMessage);
      webviewElement.removeEventListener('did-navigate', onAnnotationNavigate);
      webviewElement.removeEventListener('did-navigate-in-page', onInPageNavigate);
    };
  }, [annotationState, webviewElement]);

  const runPickerCommand = useCallback(
    (command: Parameters<typeof buildAnnotationPickerScript>[0]) => {
      try {
        adapter
          ?.executeJavaScript(
            buildAnnotationPickerScript(command, { channelId: annotationChannelIdRef.current })
          )
          .catch(() => {});
      } catch {
        // Annotation cleanup should not fail a successfully delivered prompt.
      }
    },
    [adapter]
  );

  const canAnnotate =
    adapter !== null &&
    !showStartPage &&
    (annotationState.picking || annotationState.draft === null);

  const toggleAnnotate = useCallback(() => {
    if (annotationState.draft && !annotationState.picking) return;
    runPickerCommand({ kind: annotationState.picking ? 'stop' : 'start' });
  }, [annotationState, runPickerCommand]);

  const commitDraft = useCallback(
    (comment: string) => {
      if (annotationState.commitDraft(comment)) {
        runPickerCommand({ kind: 'request-rects' });
      }
    },
    [annotationState, runPickerCommand]
  );

  const cancelDraft = useCallback(() => {
    const draft = annotationState.cancelDraft();
    if (draft) runPickerCommand({ kind: 'untrack', token: draft.token });
  }, [annotationState, runPickerCommand]);

  const removeAnnotation = useCallback(
    (token: number, epoch: number) => {
      const isCurrentEpoch = epoch === annotationState.navigationEpoch;
      annotationState.removeAnnotation(token, epoch);
      // The page tracker only knows tokens from the current page context.
      if (isCurrentEpoch) runPickerCommand({ kind: 'untrack', token });
    },
    [annotationState, runPickerCommand]
  );

  const clearAnnotations = useCallback(() => {
    annotationState.clearAll();
    runPickerCommand({ kind: 'clear-tracked' });
  }, [annotationState, runPickerCommand]);

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
        annotateActive={annotationState.picking}
        canAnnotate={canAnnotate}
        onToggleAnnotate={toggleAnnotate}
        onNavigate={navigateTo}
        onReload={reload}
        onForceReload={forceReload}
        onSetZoomFactor={setZoomFactor}
        onFocusUrl={(focus) => {
          focusUrlRef.current = focus;
        }}
      />
      <div className="emlight relative min-h-0 flex-1 bg-background">
        {showStartPage ? (
          <BrowserStartPage devServerUrls={devServers.urls} onOpenUrl={navigateTo} />
        ) : webviewProps && isRegistered ? (
          <>
            <webview
              key={`${webviewMount?.browserId ?? 'browser'}:${webviewMount?.revision ?? 0}`}
              ref={attachWebview}
              {...webviewProps}
              className="h-full w-full bg-background"
            />
            <BrowserAnnotationOverlay
              state={annotationState}
              zoomFactor={session.zoomFactor}
              onCommitDraft={commitDraft}
              onCancelDraft={cancelDraft}
              onRemoveAnnotation={removeAnnotation}
            />
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-foreground-muted">
            Preparing browser session
          </div>
        )}
        <BrowserAnnotationBar
          state={annotationState}
          onSent={clearAnnotations}
          onClearAll={clearAnnotations}
          onRemoveAnnotation={removeAnnotation}
        />
      </div>
    </div>
  );
});
