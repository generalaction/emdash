import React from 'react';
import { X, RefreshCw, ArrowLeft, ArrowRight, ExternalLink, Bug, Globe } from 'lucide-react';
import { useBrowser } from '@/providers/BrowserProvider';
import { cn } from '@/lib/utils';
import { Spinner } from './ui/spinner';

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const HANDLE_PX = 6; // left gutter reserved for drag handle; keep preview bounds clear of it

const BrowserPane: React.FC<{ workspaceId?: string | null; workspacePath?: string | null }> = ({ workspaceId, workspacePath }) => {
  const { isOpen, url, widthPct, setWidthPct, close, navigate, busy, setBusy } = useBrowser();
  const [address, setAddress] = React.useState<string>('');
  const [title, setTitle] = React.useState<string>('');
  const [loading, setLoading] = React.useState<boolean>(false);
  const [canBack, setCanBack] = React.useState(false);
  const [canFwd, setCanFwd] = React.useState(false);
  const webviewRef = React.useRef<Electron.WebviewTag | null>(null);
  const [devCommand] = React.useState<string>('');
  const [preferredUrl] = React.useState<string>('');
  const [lines, setLines] = React.useState<string[]>([]);
  const [dragging, setDragging] = React.useState<boolean>(false);
  const widthPctRef = React.useRef<number>(widthPct);
  React.useEffect(() => { widthPctRef.current = widthPct; }, [widthPct]);

  // Bind ref to provider
  React.useEffect(() => {
    const el = webviewRef.current;
    const dispatch = (detail: any) =>
      window.dispatchEvent(new CustomEvent('emdash:browser:internal', { detail }));
    if (el) dispatch({ type: 'bind', target: el });
    return () => { dispatch({ type: 'bind', target: null }); };
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
    if (prev && cur && prev !== cur) {
      try {
        (window as any).electronAPI?.hostPreviewStop?.(prev);
        localStorage.removeItem(`emdash:preview:running:${prev}`);
      } catch {}
    }
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
            setBusy(false);
          }
        }
        if (data.type === 'url' && data.url) {
          const appPort = Number(window.location.port || 0);
          try {
            const p = Number(new URL(String(data.url)).port || 0);
            if (appPort !== 0 && p === appPort) return;
          } catch {}
          // Mark busy and navigate; a readiness probe below will clear busy when reachable
          setBusy(true);
          navigate(String(data.url));
          try { localStorage.setItem(`emdash:browser:lastUrl:${workspaceId}`, String(data.url)); } catch {}
        }
      } catch {}
    });
    return () => { try { off?.(); } catch {} };
  }, [workspaceId, navigate, setBusy]);

  // When URL changes, keep spinner until the URL responds at least once
  React.useEffect(() => {
    let cancelled = false;
    const u = (url || '').trim();
    if (!u) return;
    // Kick a lightweight readiness probe to avoid white screen with no feedback
    (async () => {
      const deadline = Date.now() + 15000; // 15s max
      const tryOnce = async () => {
        try {
          const c = new AbortController();
          const t = setTimeout(() => c.abort(), 900);
          await fetch(u, { mode: 'no-cors', signal: c.signal });
          clearTimeout(t);
          return true;
        } catch {
          return false;
        }
      };
      // If already busy=false (e.g., manual set), don’t force it back on
      setBusy(true);
      while (!cancelled && Date.now() < deadline) {
        const ok = await tryOnce();
        if (ok) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!cancelled) setBusy(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [url, setBusy]);

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
      try { (window as any).electronAPI?.browserHide?.(); } catch {}
      return;
    }
    const bounds = computeBounds();
    if (bounds) {
      try { (window as any).electronAPI?.browserShow?.(bounds, url || undefined); } catch {}
    }
    const onResize = () => {
      const b = computeBounds();
      if (b) try { (window as any).electronAPI?.browserSetBounds?.(b); } catch {}
    };
    window.addEventListener('resize', onResize);
    const RO = (window as any).ResizeObserver;
    const ro = RO ? new RO(() => onResize()) : null;
    if (ro && containerRef.current) ro.observe(containerRef.current);
    return () => {
      try { (window as any).electronAPI?.browserHide?.(); } catch {}
      window.removeEventListener('resize', onResize);
      try { ro?.disconnect?.(); } catch {}
    };
  }, [isOpen, url, computeBounds]);

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
      try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch {}
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
      try { if (pointerId != null) handle.releasePointerCapture?.(pointerId); } catch {}
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

  const { goBack, goForward, reload, execJS } = useBrowser();

  return (
    <div
      className={cn(
        'fixed left-0 right-0 bottom-0 z-[70] overflow-hidden',
        isOpen ? 'pointer-events-auto' : 'pointer-events-none'
      )}
      // Offset below the app titlebar so the pane’s toolbar is visible
      style={{ top: 'var(--tb, 36px)' }}
      aria-hidden={!isOpen}
    >
      <div
        className="absolute right-0 top-0 h-full bg-background shadow-xl border-l border-border"
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
              {['http://localhost:5173', 'http://localhost:3000', 'http://localhost:8080'].map((u) => (
                <button
                  key={u}
                  type="button"
                  className="inline-flex items-center rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                  onClick={() => navigate(u)}
                >
                  {u.replace('http://', '')}
                </button>
              ))}
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
        {(!busy && url && lines.length > 0) && (
          <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-2 py-1 text-xs">
            <span className="font-medium">Workspace Preview</span>
            <div className="ml-auto inline-flex items-center gap-2 text-muted-foreground">
              {/* Show only last log line here; spinner is centered overlay while busy */}
              {lines.length ? (
                <span className="truncate max-w-[360px]">{lines[lines.length - 1]}</span>
              ) : null}
            </div>
          </div>
        )}

        <div className="relative min-h-0">
          <div id="emdash-browser-drag" className="absolute left-0 top-0 z-[200] h-full w-[6px] cursor-col-resize hover:bg-border/60" />
          <div ref={containerRef} className="h-full w-full" />
          {dragging ? (
            <div className="absolute inset-0 z-[180] cursor-col-resize" style={{ background: 'transparent' }} />
          ) : null}
          {(busy || !url) ? (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
              <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-background/95 px-4 py-3 text-sm text-muted-foreground shadow-sm backdrop-blur-[1px]">
                <Spinner size="md" />
                <div className="leading-tight">
                  <div className="font-medium text-foreground">Loading preview…</div>
                  <div className="text-xs text-muted-foreground/80">Starting or connecting to your dev server</div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default BrowserPane;
