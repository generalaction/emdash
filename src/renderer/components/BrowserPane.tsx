import React from 'react';
import {
  X,
  RefreshCw,
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Bug,
  Info,
  Wrench,
  Play,
} from 'lucide-react';
import { useBrowser } from '@/providers/BrowserProvider';
import { cn } from '@/lib/utils';
import { Spinner } from './ui/spinner';
import { setLastUrl, setRunning } from '@/lib/previewStorage';
import { PROBE_TIMEOUT_MS, SPINNER_MAX_MS, isAppPort } from '@/lib/previewNetwork';

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const HANDLE_PX = 6; // left gutter reserved for drag handle; keep preview bounds clear of it

const BrowserPane: React.FC<{
  workspaceId?: string | null;
  workspacePath?: string | null;
  overlayActive?: boolean;
}> = ({ workspaceId, workspacePath, overlayActive = false }) => {
  const {
    isOpen,
    url,
    widthPct,
    setWidthPct,
    close,
    navigate,
    clearUrl,
    busy,
    showSpinner,
    hideSpinner,
  } = useBrowser();
  const [address, setAddress] = React.useState<string>('');
  const [title, setTitle] = React.useState<string>('');
  const [loading, setLoading] = React.useState<boolean>(false);
  const [canBack, setCanBack] = React.useState(false);
  const [canFwd, setCanFwd] = React.useState(false);
  const webviewRef = React.useRef<Electron.WebviewTag | null>(null);
  const [lines, setLines] = React.useState<string[]>([]);
  const [dragging, setDragging] = React.useState<boolean>(false);
  const widthPctRef = React.useRef<number>(widthPct);
  React.useEffect(() => {
    widthPctRef.current = widthPct;
  }, [widthPct]);
  const [failed, setFailed] = React.useState<boolean>(false);
  const [retryTick, setRetryTick] = React.useState<number>(0);
  const [actionBusy, setActionBusy] = React.useState<null | 'install' | 'start'>(null);
  const [overlayRaised, setOverlayRaised] = React.useState<boolean>(false);

  // Listen for global overlay events (e.g., feedback modal) and hide preview when active
  React.useEffect(() => {
    const onOverlay = (e: any) => {
      try {
        setOverlayRaised(Boolean(e?.detail?.open));
      } catch {}
    };
    window.addEventListener('emdash:overlay:changed', onOverlay as any);
    return () => window.removeEventListener('emdash:overlay:changed', onOverlay as any);
  }, []);

  // Bind ref to provider
  React.useEffect(() => {
    const el = webviewRef.current;
    const dispatch = (detail: any) =>
      window.dispatchEvent(new CustomEvent('emdash:browser:internal', { detail }));
    if (el) dispatch({ type: 'bind', target: el });
    return () => {
      dispatch({ type: 'bind', target: null });
    };
  }, []);

  // Keep address bar in sync
  React.useEffect(() => {
    if (typeof url === 'string') setAddress(url);
  }, [url]);

  // We removed inline inputs; advanced preview settings can move to Settings later.
  // Stop the previous workspace server only when switching workspaces
  const prevWorkspaceIdRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const prev = prevWorkspaceIdRef.current;
    const cur = (workspaceId || '').trim() || null;
    try {
      // Stop all other preview servers except the new current (if any)
      (window as any).electronAPI?.hostPreviewStopAll?.(cur || '');
    } catch {}
    if (prev && cur && prev !== cur) {
      try {
        setRunning(prev, false);
      } catch {}
    }
    try {
      clearUrl();
    } catch {}
    try {
      hideSpinner();
    } catch {}
    setFailed(false);
    prevWorkspaceIdRef.current = cur;
  }, [workspaceId]);

  React.useEffect(() => {
    const off = (window as any).electronAPI?.onHostPreviewEvent?.((data: any) => {
      try {
        if (!data || !workspaceId || data.workspaceId !== workspaceId) return;
        if (data.type === 'setup') {
          if (data.status === 'line' && data.line) {
            setLines((prev) => {
              const next = [...prev, String(data.line).trim()].slice(-8);
              return next;
            });
          }
          // Only clear busy on error. On 'done' we likely start the dev server next,
          // so we keep the spinner until a URL is reachable.
          if (data.status === 'error') {
            hideSpinner();
            setActionBusy(null);
          }
          if (data.status === 'done') {
            // Install finished successfully: re-enable action buttons, but keep spinner until URL is reachable
            setActionBusy(null);
          }
        }
        if (data.type === 'url' && data.url) {
          setFailed(false);
          const appPort = Number(window.location.port || 0);
          if (isAppPort(String(data.url), appPort)) return;
          // Mark busy and navigate; a readiness probe below will clear busy when reachable
          showSpinner();
          navigate(String(data.url));
          try {
            setLastUrl(String(workspaceId), String(data.url));
          } catch {}
        }
        if (data.type === 'exit') {
          try {
            setRunning(String(workspaceId), false);
          } catch {}
          hideSpinner();
        }
      } catch {}
    });
    return () => {
      try {
        off?.();
      } catch {}
    };
  }, [workspaceId, navigate, showSpinner, hideSpinner]);

  // When URL changes, keep spinner until the URL responds at least once
  React.useEffect(() => {
    let cancelled = false;
    const u = (url || '').trim();
    if (!u) return;
    // Kick a lightweight readiness probe to avoid white screen with no feedback
    (async () => {
      const deadline = Date.now() + SPINNER_MAX_MS; // cap spinner
      const tryOnce = async () => {
        try {
          const c = new AbortController();
          const t = setTimeout(() => c.abort(), PROBE_TIMEOUT_MS);
          await fetch(u, { mode: 'no-cors', signal: c.signal });
          clearTimeout(t);
          return true;
        } catch {
          return false;
        }
      };
      // If already busy=false (e.g., manual set), don’t force it back on
      showSpinner();
      let ok = false;
      while (!cancelled && Date.now() < deadline) {
        ok = await tryOnce();
        if (ok) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!cancelled) {
        hideSpinner();
        setFailed(!ok);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, showSpinner, hideSpinner, retryTick]);

  const handleRetry = React.useCallback(() => {
    if (!url) return;
    showSpinner();
    try {
      (window as any).electronAPI?.browserReload?.();
    } catch {}
    setRetryTick((n) => n + 1);
  }, [url, showSpinner]);

  const handleInstall = React.useCallback(async () => {
    const id = (workspaceId || '').trim();
    const wp = (workspacePath || '').trim();
    if (!id || !wp) return;
    setActionBusy('install');
    showSpinner();
    try {
      await (window as any).electronAPI?.hostPreviewSetup?.({ workspaceId: id, workspacePath: wp });
      // Success: unlock actions; spinner remains until URL reachable or user retries
      setActionBusy(null);
    } catch {
      setActionBusy(null);
      hideSpinner();
    }
  }, [workspaceId, workspacePath, showSpinner, hideSpinner]);

  const handleStart = React.useCallback(async () => {
    const id = (workspaceId || '').trim();
    const wp = (workspacePath || '').trim();
    if (!id || !wp) return;
    setActionBusy('start');
    showSpinner();
    try {
      await (window as any).electronAPI?.hostPreviewStart?.({ workspaceId: id, workspacePath: wp });
      // Success: unlock actions; spinner remains until URL reachable or user retries
      setActionBusy(null);
    } catch {
      setActionBusy(null);
      hideSpinner();
    }
  }, [workspaceId, workspacePath, showSpinner, hideSpinner]);

  // Switch to main-managed Browser (WebContentsView): report bounds + drive navigation via preload.
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const computeBounds = React.useCallback(() => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    // Leave a small gutter on the left for the drag handle so it can receive events above the preview view
    const x = Math.round(rect.left + HANDLE_PX);
    const y = Math.round(rect.top);
    const w = Math.max(1, Math.round(rect.width - HANDLE_PX));
    const h = Math.round(rect.height);
    return { x, y, width: w, height: h };
  }, []);

  React.useEffect(() => {
    if (!isOpen) {
      try {
        (window as any).electronAPI?.browserHide?.();
      } catch {}
      return;
    }
    if (overlayActive || overlayRaised) {
      try {
        (window as any).electronAPI?.browserHide?.();
      } catch {}
      return;
    }
    // If no URL yet, keep the native preview view hidden to avoid showing stale content
    if (!url) {
      try {
        (window as any).electronAPI?.browserHide?.();
      } catch {}
      return;
    }
    const bounds = computeBounds();
    if (bounds) {
      try {
        (window as any).electronAPI?.browserShow?.(bounds, url || undefined);
      } catch {}
    }
    const onResize = () => {
      const b = computeBounds();
      if (b)
        try {
          (window as any).electronAPI?.browserSetBounds?.(b);
        } catch {}
    };
    window.addEventListener('resize', onResize);
    const RO = (window as any).ResizeObserver;
    const ro = RO ? new RO(() => onResize()) : null;
    if (ro && containerRef.current) ro.observe(containerRef.current);
    return () => {
      try {
        (window as any).electronAPI?.browserHide?.();
      } catch {}
      window.removeEventListener('resize', onResize);
      try {
        ro?.disconnect?.();
      } catch {}
    };
  }, [isOpen, url, computeBounds, overlayActive, overlayRaised]);

  // No programmatic load of about:blank to avoid ERR_ABORTED noise.
  React.useEffect(() => {
    if (isOpen && !url) setAddress('');
  }, [isOpen, url]);

  // Drag-resize from the left edge
  React.useEffect(() => {
    let dragging = false;
    let pointerId: number | null = null;
    let startX = 0;
    let startPct = widthPctRef.current;
    const handle = document.getElementById('emdash-browser-drag');
    if (!handle) return;

    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      pointerId = e.pointerId;
      try {
        (e.target as Element).setPointerCapture?.(e.pointerId);
      } catch {}
      setDragging(true);
      startX = e.clientX;
      startPct = widthPctRef.current;
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = startX - e.clientX; // dragging handle to left increases width
      const vw = Math.max(1, window.innerWidth);
      const deltaPct = (dx / vw) * 100;
      setWidthPct(clamp(startPct + deltaPct, 5, 96));
      e.preventDefault();
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      try {
        if (pointerId != null) handle.releasePointerCapture?.(pointerId);
      } catch {}
      pointerId = null;
      setDragging(false);
      document.body.style.cursor = '';
      e.preventDefault();
    };

    handle.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp, { passive: false });
    return () => {
      handle.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove as any);
      window.removeEventListener('pointerup', onPointerUp as any);
      setDragging(false);
      document.body.style.cursor = '';
    };
  }, [setWidthPct]);

  const { goBack, goForward, reload } = useBrowser();

  return (
    <div
      className={cn(
        'fixed bottom-0 left-0 right-0 z-[70] overflow-hidden',
        isOpen ? 'pointer-events-auto' : 'pointer-events-none'
      )}
      // Offset below the app titlebar so the pane’s toolbar is visible
      style={{ top: 'var(--tb, 36px)' }}
      aria-hidden={!isOpen}
    >
      <div
        className="absolute right-0 top-0 h-full border-l border-border bg-background shadow-xl"
        style={{
          width: `${widthPct}%`,
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 220ms cubic-bezier(0.22,1,0.36,1), opacity 220ms',
          opacity: isOpen ? 1 : 0,
          display: 'grid',
          gridTemplateRows: '36px 1fr',
          zIndex: 10,
        }}
      >
        <div className="flex items-center gap-1 border-b border-border bg-gray-50 px-2 dark:bg-gray-900">
          <button
            className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted"
            onClick={() => goBack()}
            disabled={!canBack}
            title="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted"
            onClick={() => goForward()}
            disabled={!canFwd}
            title="Forward"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted"
            onClick={() => reload()}
            title="Reload"
          >
            <RefreshCw className={cn('h-4 w-4', loading ? 'animate-spin' : '')} />
          </button>
          <form
            className="mx-2 flex min-w-0 flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              let next = address.trim();
              if (!/^https?:\/\//i.test(next)) next = `http://${next}`;
              navigate(next);
            }}
          >
            <input
              className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs outline-none"
              value={address ?? ''}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Enter URL (e.g. http://localhost:5173)"
            />
          </form>
          {!url ? (
            <div className="hidden items-center gap-1.5 sm:flex">
              {['http://localhost:5173', 'http://localhost:3000', 'http://localhost:8080'].map(
                (u) => (
                  <button
                    key={u}
                    type="button"
                    className="inline-flex items-center rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                    onClick={() => navigate(u)}
                  >
                    {u.replace('http://', '')}
                  </button>
                )
              )}
            </div>
          ) : null}
          <button
            className="inline-flex h-6 items-center gap-1 rounded border border-border px-2 text-xs hover:bg-muted"
            title="Open in system browser"
            onClick={() => address && window.electronAPI.openExternal(address)}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
          {/* <button
            className="inline-flex h-6 items-center gap-1 rounded border border-border px-2 text-xs hover:bg-muted"
            title="Open DevTools"
            onClick={() => {
              const el = webviewRef.current as any;
              try { el?.openDevTools?.(); } catch {}
            }}
          >
            <Bug className="h-3.5 w-3.5" />
          </button> */}
          <button
            className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted"
            onClick={close}
            title="Close"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {!busy && url && lines.length > 0 && (
          <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-2 py-1 text-xs">
            <span className="font-medium">Workspace Preview</span>
            <div className="ml-auto inline-flex items-center gap-2 text-muted-foreground">
              {lines.length ? (
                <span className="max-w-[360px] truncate">{lines[lines.length - 1]}</span>
              ) : null}
            </div>
          </div>
        )}

        <div className="relative min-h-0">
          <div
            id="emdash-browser-drag"
            className="absolute left-0 top-0 z-[200] h-full w-[6px] cursor-col-resize hover:bg-border/60"
          />
          <div ref={containerRef} className="h-full w-full" />
          {dragging ? (
            <div
              className="absolute inset-0 z-[180] cursor-col-resize"
              style={{ background: 'transparent' }}
            />
          ) : null}
          {busy || !url ? (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
              <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-background/95 px-4 py-3 text-sm text-muted-foreground shadow-sm backdrop-blur-[1px]">
                <Spinner size="md" />
                <div className="leading-tight">
                  <div className="font-medium text-foreground">Loading preview…</div>
                  <div className="text-xs text-muted-foreground/80">
                    Starting or connecting to your dev server
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          {!busy && url && failed ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
              <div className="w-full max-w-xl rounded-xl border border-border/70 bg-background/95 p-4 text-sm text-muted-foreground shadow-sm">
                <div className="flex items-start gap-2">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/70 bg-muted/50">
                    <Info className="h-3.5 w-3.5 text-muted-foreground" />
                  </span>
                  <div className="flex-1">
                    <div className="font-medium text-foreground">Preview not reachable</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      We couldn’t connect to{' '}
                      <span className="font-mono text-foreground/80">{url}</span>. This often means
                      dependencies aren’t installed or the dev server hasn’t started yet.
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/70 bg-background px-2.5 text-xs font-medium hover:bg-muted/50 disabled:opacity-60"
                    onClick={handleInstall}
                    disabled={!workspaceId || !workspacePath || actionBusy === 'start'}
                  >
                    {actionBusy === 'install' ? (
                      <Spinner size="sm" />
                    ) : (
                      <Wrench className="h-3.5 w-3.5" />
                    )}
                    Install dependencies
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/70 bg-background px-2.5 text-xs font-medium hover:bg-muted/50 disabled:opacity-60"
                    onClick={handleStart}
                    disabled={!workspaceId || !workspacePath || actionBusy === 'install'}
                  >
                    {actionBusy === 'start' ? (
                      <Spinner size="sm" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                    Start dev server
                  </button>
                  <span className="mx-1 h-5 w-px bg-border/70" />
                  <button
                    type="button"
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/70 bg-background px-2.5 text-xs font-medium hover:bg-muted/50"
                    onClick={handleRetry}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Retry
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/70 bg-background px-2.5 text-xs font-medium hover:bg-muted/50"
                    onClick={() => url && (window as any).electronAPI?.openExternal?.(url)}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open in browser
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/70 bg-background px-2.5 text-xs font-medium hover:bg-muted/50"
                    onClick={() => (window as any).electronAPI?.browserOpenDevTools?.()}
                  >
                    <Bug className="h-3.5 w-3.5" />
                    Open DevTools
                  </button>
                </div>
                {lines.length ? (
                  <div className="mt-3 rounded-md border border-dashed border-border/70 bg-muted/40 p-2">
                    <div className="text-[11px] leading-snug text-muted-foreground">
                      <span className="font-medium text-foreground">Last setup log</span>
                      <div className="mt-1 font-mono text-[11px] text-foreground/80">
                        {lines[lines.length - 1]}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default BrowserPane;
