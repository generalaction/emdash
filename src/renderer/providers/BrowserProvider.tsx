import React from 'react';

type BrowserController = {
  isOpen: boolean;
  url: string | null;
  widthPct: number; // 10..90
  busy: boolean;
  open: (url?: string) => void;
  close: () => void;
  toggle: (url?: string) => void;
  navigate: (url: string) => void;
  setWidthPct: (pct: number) => void;
  execJS: (code: string) => Promise<any>;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  focus: () => void;
  setBusy: (next: boolean) => void;
};

const Ctx = React.createContext<BrowserController | null>(null);

export const BrowserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const webviewRef = React.useRef<any>(null);
  const [isOpen, setOpen] = React.useState(false);
  const [url, setUrl] = React.useState<string | null>(null);
  const [widthPct, setWidthPctState] = React.useState<number>(50);
  const [busy, setBusyState] = React.useState<boolean>(false);

  const ensureRef = () => webviewRef.current as any;

  const navigate = React.useCallback((next: string) => {
    setUrl(next);
    try {
      const api: any = (window as any).electronAPI;
      if (api && typeof api.browserLoadURL === 'function') {
        api.browserLoadURL(next);
        return;
      }
    } catch {}
    const el = ensureRef();
    try {
      if (el && el.getURL && el.getURL() !== next) {
        el.loadURL(next).catch(() => {});
      }
    } catch {}
  }, []);

  const open = React.useCallback(
    (nextUrl?: string) => {
      if (nextUrl) navigate(nextUrl);
      setOpen(true);
    },
    [navigate]
  );

  const close = React.useCallback(() => setOpen(false), []);
  const toggle = React.useCallback(
    (nextUrl?: string) => {
      setOpen((prev) => {
        const nextState = !prev;
        if (nextState && nextUrl) navigate(nextUrl);
        return nextState;
      });
    },
    [navigate]
  );

  const execJS = React.useCallback(async (code: string) => {
    const el = ensureRef() as any;
    if (!el || typeof el.executeJavaScript !== 'function') return undefined;
    try {
      return await el.executeJavaScript(code, true);
    } catch {
      return undefined;
    }
  }, []);

  const goBack = React.useCallback(() => {
    try {
      const api: any = (window as any).electronAPI;
      if (api && typeof api.browserGoBack === 'function') {
        api.browserGoBack();
        return;
      }
    } catch {}
    const el = ensureRef();
    if (el && el.canGoBack()) el.goBack();
  }, []);
  const goForward = React.useCallback(() => {
    try {
      const api: any = (window as any).electronAPI;
      if (api && typeof api.browserGoForward === 'function') {
        api.browserGoForward();
        return;
      }
    } catch {}
    const el = ensureRef();
    if (el && el.canGoForward()) el.goForward();
  }, []);
  const reload = React.useCallback(() => {
    try {
      const api: any = (window as any).electronAPI;
      if (api && typeof api.browserReload === 'function') {
        api.browserReload();
        return;
      }
    } catch {}
    const el = ensureRef();
    if (el) el.reload();
  }, []);
  const focus = React.useCallback(() => ensureRef()?.focus(), []);

  const setPaneWidthPct = React.useCallback((pct: number) => {
    // Allow a much wider range for user control
    const clamped = Math.max(5, Math.min(96, Math.round(pct)));
    setWidthPctState(clamped);
  }, []);

  const value = React.useMemo<BrowserController>(
    () => ({
      isOpen,
      url,
      widthPct,
      busy,
      open,
      close,
      toggle,
      navigate,
      setWidthPct: setPaneWidthPct,
      execJS,
      goBack,
      goForward,
      reload,
      focus,
      setBusy: setBusyState,
    }),
    [
      isOpen,
      url,
      widthPct,
      busy,
      open,
      close,
      toggle,
      navigate,
      setPaneWidthPct,
      execJS,
      goBack,
      goForward,
      reload,
      focus,
    ]
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* Portal: inline consumer component owns the actual webview element */}
      <div id="emdash-browser-root" />
      {/* Hidden ref target used by BrowserPane to bind the underlying <webview> */}
      <BrowserViewRefBinder refObj={webviewRef} onUrlChange={setUrl} />
    </Ctx.Provider>
  );
};

export function useBrowser() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error('useBrowser must be used within a BrowserProvider');
  return ctx;
}

// An invisible singleton helper that lets BrowserPane register the webview ref
const BrowserViewRefBinder: React.FC<{
  refObj: React.MutableRefObject<Electron.WebviewTag | null>;
  onUrlChange: (u: string | null) => void;
}> = ({ refObj, onUrlChange }) => {
  React.useEffect(() => {
    const handler = (e: any) => {
      if (!e || !e.detail) return;
      const { type, target, url } = e.detail || {};
      if (type === 'bind' && target) {
        refObj.current = target as any;
      } else if (type === 'update-url') {
        onUrlChange(typeof url === 'string' ? url : null);
      }
    };
    window.addEventListener('emdash:browser:internal', handler as any);
    return () => window.removeEventListener('emdash:browser:internal', handler as any);
  }, [refObj, onUrlChange]);
  return null;
};

export default BrowserProvider;
