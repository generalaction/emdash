import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { rpc } from '@renderer/lib/ipc';
import {
  createBrowserWebviewAdapter,
  type BrowserWebviewAdapter,
  type BrowserWebviewElement,
} from './browser-webview-types';

const WEBVIEW_ALLOW_POPUPS_ATTRIBUTE = 'true' as unknown as boolean;
const HIDDEN_WEBVIEW_STYLE: CSSProperties = {
  position: 'fixed',
  left: '-10000px',
  top: 0,
  width: '1280px',
  height: '720px',
  pointerEvents: 'none',
};

export type BrowserWebviewBinding = {
  adapter: BrowserWebviewAdapter;
  webview: BrowserWebviewElement;
};

export type BrowserWebviewHostProps = {
  lifecycleKey: string;
  browserId: string;
  partition: string;
  src: string;
  registration: 'renderer' | 'main';
  hidden?: boolean;
  allowPopups?: boolean;
  className?: string;
  onWebviewChange?: (webview: BrowserWebviewElement | null) => void;
  onBound?: (binding: BrowserWebviewBinding) => void;
  onBindFailed?: () => void;
  onDisposed?: () => void;
};

export function BrowserWebviewHost({
  lifecycleKey,
  browserId,
  partition,
  src,
  registration,
  hidden = false,
  allowPopups = true,
  className,
  onWebviewChange,
  onBound,
  onBindFailed,
  onDisposed,
}: BrowserWebviewHostProps) {
  const webviewRef = useRef<BrowserWebviewElement | null>(null);
  const generationRef = useRef(0);
  const callbacksRef = useRef({ onWebviewChange, onBound, onBindFailed, onDisposed });
  callbacksRef.current = { onWebviewChange, onBound, onBindFailed, onDisposed };
  const [webviewElement, setWebviewElement] = useState<BrowserWebviewElement | null>(null);
  const registrationIdentity = `${browserId}\u0000${partition}`;
  const [registeredIdentity, setRegisteredIdentity] = useState<string | null>(
    registration === 'main' ? registrationIdentity : null
  );

  useEffect(() => {
    const generation = ++generationRef.current;
    let disposed = false;
    setRegisteredIdentity(registration === 'main' ? registrationIdentity : null);

    if (registration === 'renderer') {
      void rpc.browser.registerSession({ browserId, partition }).then((result) => {
        if (disposed || generationRef.current !== generation) return;
        if (result.success) setRegisteredIdentity(registrationIdentity);
        else callbacksRef.current.onBindFailed?.();
      });
    }

    return () => {
      disposed = true;
      generationRef.current += 1;
    };
  }, [browserId, partition, registration, registrationIdentity]);

  useEffect(
    () => () => {
      callbacksRef.current.onDisposed?.();
    },
    []
  );

  const attachWebview = useCallback((node: Element | null) => {
    const next = node as BrowserWebviewElement | null;
    if (webviewRef.current === next) return;
    webviewRef.current = next;
    setWebviewElement(next);
    callbacksRef.current.onWebviewChange?.(next);
  }, []);

  useEffect(() => {
    if (!webviewElement) return;
    const generation = generationRef.current;
    let disposed = false;
    let binding = false;
    let bound = false;

    const bindWebview = async () => {
      try {
        const result = await rpc.browser.bindWebContents({
          browserId,
          webContentsId: webviewElement.getWebContentsId(),
        });
        binding = false;
        if (
          disposed ||
          generationRef.current !== generation ||
          webviewRef.current !== webviewElement
        ) {
          return;
        }
        if (!result.success) {
          callbacksRef.current.onBindFailed?.();
          return;
        }
        bound = true;
        callbacksRef.current.onBound?.({
          adapter: createBrowserWebviewAdapter(webviewElement),
          webview: webviewElement,
        });
      } catch {
        binding = false;
        if (
          !disposed &&
          generationRef.current === generation &&
          webviewRef.current === webviewElement
        ) {
          callbacksRef.current.onBindFailed?.();
        }
      }
    };

    const handleDomReady = () => {
      if (disposed || binding || bound || webviewRef.current !== webviewElement) return;
      binding = true;
      void bindWebview();
    };

    webviewElement.addEventListener('dom-ready', handleDomReady);
    return () => {
      disposed = true;
      webviewElement.removeEventListener('dom-ready', handleDomReady);
    };
  }, [browserId, lifecycleKey, webviewElement]);

  const registered = registration === 'main' || registeredIdentity === registrationIdentity;
  if (!registered) return null;

  return (
    <webview
      key={lifecycleKey}
      ref={attachWebview}
      src={src}
      partition={partition}
      {...(allowPopups ? { allowpopups: WEBVIEW_ALLOW_POPUPS_ATTRIBUTE } : {})}
      data-browser-id={browserId}
      data-lifecycle-key={lifecycleKey}
      className={className}
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
      style={hidden ? HIDDEN_WEBVIEW_STYLE : undefined}
    />
  );
}
