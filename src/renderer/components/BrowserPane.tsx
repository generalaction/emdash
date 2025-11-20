import React from 'react';
import { X, ArrowLeft, ArrowRight, ExternalLink } from 'lucide-react';
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
  // const [loading] = React.useState<boolean>(false);
  const [canBack] = React.useState(false);
  const [canFwd] = React.useState(false);
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

  // Stop the previous workspace server only when switching workspaces
  const prevWorkspaceIdRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const prev = prevWorkspaceIdRef.current;
    const cur = (workspaceId || '').trim() || null;
    
    // If workspace changed, hide browser view and clear everything
    if (prev && cur && prev !== cur) {
      try {
        // Clear and hide browser view immediately when switching worktrees
        (window as any).electronAPI?.browserClear?.();
        (window as any).electronAPI?.browserHide?.();
        setRunning(prev, false);
      } catch {}
    }
    
    try {
      // Stop all other preview servers except the new current (if any)
      (window as any).electronAPI?.hostPreviewStopAll?.(cur || '');
    } catch {}
    
    // Always clear URL and reset state when workspace changes
    if (prev !== cur) {
      try {
        clearUrl();
        hideSpinner();
        setFailed(false);
        setLines([]); // Clear log lines when switching worktrees
      } catch {}
    }
    
    prevWorkspaceIdRef.current = cur;
  }, [workspaceId, clearUrl, hideSpinner]);

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
          // CRITICAL: Only process URL events for the current workspaceId
          // This ensures we don't load URLs from other worktrees
          if (!workspaceId || data.workspaceId !== workspaceId) {
            return;
          }
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

  // When URL changes, verify reachability (TCP probe) with a generous grace window
  // Note: Spinner is already shown by the event handler, so we don't show it again here
  React.useEffect(() => {
    let cancelled = false;
    const u = (url || '').trim();
    if (!u) {
      setFailed(false);
      return;
    }
    (async () => {
      try {
        const parsed = new URL(u);
        const host = parsed.hostname || 'localhost';
        const port = Number(parsed.port || 0);
        if (!port) {
          setFailed(false);
          return;
        }
        // Don't show spinner here - it's already shown by the event handler
        // This probe runs in the background to verify reachability
        const deadline = Date.now() + SPINNER_MAX_MS; // ~30s grace for compilers (e.g., Next initial build)
        let ok = false;
        while (!cancelled && Date.now() < deadline) {
          try {
            const res = await (window as any).electronAPI?.netProbePorts?.(
              host,
              [port],
              PROBE_TIMEOUT_MS
            );
            ok = !!(res && Array.isArray(res.reachable) && res.reachable.length > 0);
            if (ok) break;
          } catch {}
          await new Promise((r) => setTimeout(r, 500));
        }
        if (!cancelled) {
          // Only hide spinner if probe succeeded or failed after deadline
          // If probe succeeded quickly, the browser view should already be loading
          if (ok) {
            hideSpinner();
          } else {
            // Server not reachable after deadline - keep spinner for user feedback
            setFailed(true);
          }
        }
      } catch {
        if (!cancelled) {
          setFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, showSpinner, hideSpinner]);

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
    const h = Math.max(1, Math.round(rect.height)); // Ensure height is at least 1
    return { x, y, width: w, height: h };
  }, []);
  
  // Store last bounds to prevent unnecessary updates
  const lastBoundsRef = React.useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  // Debounce visibility changes to prevent flashing
  const visibilityTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  React.useEffect(() => {
    // Clear any pending visibility change
    if (visibilityTimeoutRef.current) {
      clearTimeout(visibilityTimeoutRef.current);
      visibilityTimeoutRef.current = null;
    }

    // Determine if browser should be visible
    // CRITICAL: Only show if we have a valid URL and the pane is open
    const shouldShow = isOpen && !overlayActive && !overlayRaised && !!url && !!workspaceId;

    // Debounce hide operations to prevent rapid flashing
    if (!shouldShow) {
      visibilityTimeoutRef.current = setTimeout(() => {
        try {
          (window as any).electronAPI?.browserHide?.();
          lastBoundsRef.current = null; // Reset bounds when hiding
        } catch {}
        visibilityTimeoutRef.current = null;
      }, 50); // Small delay to batch rapid hide calls
      return;
    }

    // Show when conditions are met - use requestAnimationFrame to ensure container is laid out
    requestAnimationFrame(() => {
      const bounds = computeBounds();
      if (bounds && bounds.width > 0 && bounds.height > 0) {
        // Only update if bounds changed significantly (more than 2px difference)
        // This prevents unnecessary updates from minor layout shifts when logs appear
        const THRESHOLD = 2;
        const boundsChanged = !lastBoundsRef.current ||
          Math.abs(lastBoundsRef.current.x - bounds.x) > THRESHOLD ||
          Math.abs(lastBoundsRef.current.y - bounds.y) > THRESHOLD ||
          Math.abs(lastBoundsRef.current.width - bounds.width) > THRESHOLD ||
          Math.abs(lastBoundsRef.current.height - bounds.height) > THRESHOLD;
        
        if (boundsChanged) {
          lastBoundsRef.current = bounds;
          try {
            // Ensure bounds are valid and view is shown
            (window as any).electronAPI?.browserShow?.(bounds, url || undefined);
            // Force a bounds update after a short delay to ensure view is positioned correctly
            setTimeout(() => {
              const b = computeBounds();
              if (b && b.width > 0 && b.height > 0) {
                // Only update if bounds changed significantly
                if (!lastBoundsRef.current ||
                    Math.abs(lastBoundsRef.current.x - b.x) > THRESHOLD ||
                    Math.abs(lastBoundsRef.current.y - b.y) > THRESHOLD ||
                    Math.abs(lastBoundsRef.current.width - b.width) > THRESHOLD ||
                    Math.abs(lastBoundsRef.current.height - b.height) > THRESHOLD) {
                  lastBoundsRef.current = b;
                  try {
                    (window as any).electronAPI?.browserSetBounds?.(b);
                  } catch {}
                }
              }
            }, 100);
          } catch {}
        }
        // Don't reload URL if bounds haven't changed - the view is already showing the correct content
      }
    });

    const onResize = () => {
      const b = computeBounds();
      if (b && shouldShow && b.width > 0 && b.height > 0) {
        // Only update if bounds changed significantly (more than 2px difference)
        const THRESHOLD = 2;
        if (!lastBoundsRef.current ||
            Math.abs(lastBoundsRef.current.x - b.x) > THRESHOLD ||
            Math.abs(lastBoundsRef.current.y - b.y) > THRESHOLD ||
            Math.abs(lastBoundsRef.current.width - b.width) > THRESHOLD ||
            Math.abs(lastBoundsRef.current.height - b.height) > THRESHOLD) {
          lastBoundsRef.current = b;
          try {
            (window as any).electronAPI?.browserSetBounds?.(b);
          } catch {}
        }
      }
    };
    window.addEventListener('resize', onResize);
    const RO = (window as any).ResizeObserver;
    const ro = RO ? new RO(() => onResize()) : null;
    if (ro && containerRef.current) ro.observe(containerRef.current);

    return () => {
      if (visibilityTimeoutRef.current) {
        clearTimeout(visibilityTimeoutRef.current);
        visibilityTimeoutRef.current = null;
      }
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

  // Ensure URL is loaded when it changes and view is open
  const lastUrlRef = React.useRef<string | null>(null);
  const lastWorkspaceIdRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    // CRITICAL: Reset URL ref when workspaceId changes to force reload
    if (workspaceId !== lastWorkspaceIdRef.current) {
      lastUrlRef.current = null;
      lastWorkspaceIdRef.current = workspaceId;
    }
    
    if (isOpen && url && !overlayActive && !overlayRaised && workspaceId) {
      // Only load if URL actually changed or workspace changed
      if (lastUrlRef.current !== url) {
        lastUrlRef.current = url;
        // Small delay to ensure view is ready
        const timeoutId = setTimeout(() => {
          try {
            (window as any).electronAPI?.browserLoadURL?.(url);
          } catch {}
        }, 50);
        return () => clearTimeout(timeoutId);
      }
    }
  }, [isOpen, url, overlayActive, overlayRaised, workspaceId]);

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

  const { goBack, goForward } = useBrowser();

  const handleClose = React.useCallback(() => {
    try {
      const id = (workspaceId || '').trim();
      if (id) (window as any).electronAPI?.hostPreviewStop?.(id);
    } catch {}
    try {
      (window as any).electronAPI?.browserHide?.();
    } catch {}
    try {
      clearUrl();
    } catch {}
    setFailed(false);
    close();
  }, [workspaceId, clearUrl, close]);

  const isDev = typeof window !== 'undefined' && String(window.location.port || '') === '3000';

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
          display: 'flex',
          flexDirection: 'column',
          zIndex: 10,
        }}
      >
        <div className="flex items-center gap-1 border-b border-border bg-gray-50 px-2 dark:bg-gray-900 flex-shrink-0">
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
          {/* Reload removed: dev servers auto-refresh (HMR) */}
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
          <button
            className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted"
            onClick={handleClose}
            title="Close"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {!busy && url && lines.length > 0 && (
          <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-2 py-1 text-xs flex-shrink-0">
            <span className="font-medium">Workspace Preview</span>
            <div className="ml-auto inline-flex items-center gap-2 text-muted-foreground">
              {lines.length ? (
                <span className="max-w-[360px] truncate">{lines[lines.length - 1]}</span>
              ) : null}
            </div>
          </div>
        )}

        <div className="relative min-h-0 flex-1" style={{ minHeight: 0 }}>
          <div
            id="emdash-browser-drag"
            className="absolute left-0 top-0 z-[200] h-full w-[6px] cursor-col-resize hover:bg-border/60"
          />
          <div ref={containerRef} className="h-full w-full bg-white dark:bg-gray-950" />
          {dragging ? (
            <div
              className="absolute inset-0 z-[180] cursor-col-resize"
              style={{ background: 'transparent' }}
            />
          ) : null}
          {/* Show loading overlay only when busy AND no URL yet, or when action is busy (install/start) */}
          {(busy && !url) || actionBusy ? (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
              <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-background/95 px-4 py-3 text-sm text-muted-foreground shadow-sm backdrop-blur-[1px]">
                <Spinner size="md" />
                <div className="leading-tight">
                  <div className="font-medium text-foreground">Loading preview…</div>
                  <div className="text-xs text-muted-foreground/80">
                    {actionBusy === 'install'
                      ? 'Installing dependencies'
                      : actionBusy === 'start'
                        ? 'Starting dev server'
                        : 'Starting dev server'}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          {/* Show error state when URL is set but server is unreachable */}
          {url && failed && !busy && !actionBusy ? (
            <div className="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-background/80 backdrop-blur-[1px]">
              <div className="flex flex-col items-center gap-3 rounded-xl border border-border/70 bg-background/95 px-4 py-3 text-sm text-muted-foreground shadow-sm">
                <div className="leading-tight text-center">
                  <div className="font-medium text-foreground">Preview unavailable</div>
                  <div className="text-xs text-muted-foreground/80 mt-1">
                    Server at {url} is not reachable
                  </div>
                </div>
                <button
                  onClick={handleRetry}
                  className="mt-2 rounded border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default BrowserPane;
