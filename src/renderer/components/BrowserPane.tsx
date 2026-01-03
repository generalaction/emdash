import React from 'react';
import { X, ArrowLeft, ArrowRight, ExternalLink, RotateCw } from 'lucide-react';
import { useBrowser } from '@/providers/BrowserProvider';
import { cn } from '@/lib/utils';
import { Spinner } from './ui/spinner';
import { Button } from './ui/button';
import { setLastUrl, setRunning } from '@/lib/previewStorage';
import { PROBE_TIMEOUT_MS, SPINNER_MAX_MS, isAppPort } from '@/lib/previewNetwork';

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const HANDLE_PX = 6;
const BOUNDS_CHANGE_THRESHOLD = 2;
const HIDE_DEBOUNCE_MS = 50;
const URL_LOAD_DELAY_MS = 50;
const BOUNDS_UPDATE_DELAY_MS = 100;
const PROBE_RETRY_DELAY_MS = 500;
const MAX_LOG_LINES = 8;
const WIDTH_PCT_MIN = 5;
const WIDTH_PCT_MAX = 96;
const DEFAULT_PREVIEW_URLS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:8080',
];

const BrowserPane: React.FC<{
  taskId?: string | null;
  taskPath?: string | null;
  overlayActive?: boolean;
}> = ({ taskId, overlayActive = false }) => {
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
  const [lines, setLines] = React.useState<string[]>([]);
  const [dragging, setDragging] = React.useState<boolean>(false);
  const widthPctRef = React.useRef<number>(widthPct);
  React.useEffect(() => {
    widthPctRef.current = widthPct;
  }, [widthPct]);
  const [failed, setFailed] = React.useState<boolean>(false);
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

  React.useEffect(() => {
    if (typeof url === 'string') setAddress(url);
  }, [url]);

  const prevTaskIdRef = React.useRef<string | null>(null);
  const lastTaskUrlRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const prev = prevTaskIdRef.current;
    const cur = (taskId || '').trim() || null;

    if (prev && cur && prev !== cur) {
      try {
        // Clear and hide browser view immediately when switching worktrees
        (window as any).electronAPI?.browserClear?.();
        (window as any).electronAPI?.browserHide?.();
        setRunning(prev, false);
        // Reset task URL tracking to force reload
        lastTaskUrlRef.current = null;
      } catch {}
    }

    try {
      // Stop all other preview servers except the new current (if any)
      (window as any).electronAPI?.hostPreviewStopAll?.(cur || '');
    } catch {}

    if (prev !== cur) {
      try {
        clearUrl();
        hideSpinner();
        setFailed(false);
        setLines([]);
      } catch {}
    }

    prevTaskIdRef.current = cur;
  }, [taskId, clearUrl, hideSpinner]);

  React.useEffect(() => {
    const off = (window as any).electronAPI?.onHostPreviewEvent?.((data: any) => {
      try {
        if (!data || !taskId || data.taskId !== taskId) return;
        if (data.type === 'setup') {
          if (data.status === 'line' && data.line) {
            setLines((prev) => {
              const next = [...prev, String(data.line).trim()].slice(-MAX_LOG_LINES);
              return next;
            });
          }
          if (data.status === 'error') {
            hideSpinner();
          }
        }
        if (data.type === 'url' && data.url) {
          // CRITICAL: Only process URL events for the current taskId
          // This ensures we don't load URLs from other worktrees
          if (!taskId || data.taskId !== taskId) {
            return;
          }
          setFailed(false);
          const appPort = Number(window.location.port || 0);
          if (isAppPort(String(data.url), appPort)) return;
          showSpinner();
          navigate(String(data.url));
          try {
            setLastUrl(String(taskId), String(data.url));
          } catch {}
        }
        if (data.type === 'exit') {
          try {
            setRunning(String(taskId), false);
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
  }, [taskId, navigate, showSpinner, hideSpinner]);

  // Verify URL reachability with TCP probe (30s grace window for slow compilers)
  React.useEffect(() => {
    let cancelled = false;
    const urlString = (url || '').trim();
    if (!urlString) {
      setFailed(false);
      return;
    }
    (async () => {
      try {
        const parsed = new URL(urlString);
        const host = parsed.hostname || 'localhost';
        const port = Number(parsed.port || 0);
        if (!port) {
          setFailed(false);
          return;
        }
        const deadline = Date.now() + SPINNER_MAX_MS;
        let isReachable = false;
        while (!cancelled && Date.now() < deadline) {
          try {
            const res = await (window as any).electronAPI?.netProbePorts?.(
              host,
              [port],
              PROBE_TIMEOUT_MS
            );
            isReachable = !!(res && Array.isArray(res.reachable) && res.reachable.length > 0);
            if (isReachable) break;
          } catch {}
          await new Promise((r) => setTimeout(r, PROBE_RETRY_DELAY_MS));
        }
        if (!cancelled) {
          if (isReachable) {
            hideSpinner();
          } else {
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
  }, [url, showSpinner]);

  // Browser view is managed in main process (WebContentsView) via IPC
  // This component reports bounds and coordinates navigation
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const computeBounds = React.useCallback(() => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = Math.round(rect.left + HANDLE_PX);
    const y = Math.round(rect.top);
    const w = Math.max(1, Math.round(rect.width - HANDLE_PX));
    const h = Math.max(1, Math.round(rect.height));
    return { x, y, width: w, height: h };
  }, []);

  const lastBoundsRef = React.useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const hasBoundsChanged = React.useCallback(
    (newBounds: { x: number; y: number; width: number; height: number }) => {
      if (!lastBoundsRef.current) return true;
      const old = lastBoundsRef.current;
      return (
        Math.abs(old.x - newBounds.x) > BOUNDS_CHANGE_THRESHOLD ||
        Math.abs(old.y - newBounds.y) > BOUNDS_CHANGE_THRESHOLD ||
        Math.abs(old.width - newBounds.width) > BOUNDS_CHANGE_THRESHOLD ||
        Math.abs(old.height - newBounds.height) > BOUNDS_CHANGE_THRESHOLD
      );
    },
    []
  );

  const visibilityTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  React.useEffect(() => {
    if (visibilityTimeoutRef.current) {
      clearTimeout(visibilityTimeoutRef.current);
      visibilityTimeoutRef.current = null;
    }

    const shouldShow = isOpen && !overlayActive && !overlayRaised && !!url && !!taskId;

    if (!shouldShow) {
      visibilityTimeoutRef.current = setTimeout(() => {
        try {
          (window as any).electronAPI?.browserHide?.();
          lastBoundsRef.current = null;
        } catch {}
        visibilityTimeoutRef.current = null;
      }, HIDE_DEBOUNCE_MS);
      return;
    }

    requestAnimationFrame(() => {
      const bounds = computeBounds();
      if (bounds && bounds.width > 0 && bounds.height > 0) {
        if (hasBoundsChanged(bounds)) {
          lastBoundsRef.current = bounds;
          try {
            (window as any).electronAPI?.browserShow?.(bounds, url || undefined);
            setTimeout(() => {
              const updatedBounds = computeBounds();
              if (updatedBounds && updatedBounds.width > 0 && updatedBounds.height > 0) {
                if (hasBoundsChanged(updatedBounds)) {
                  lastBoundsRef.current = updatedBounds;
                  try {
                    (window as any).electronAPI?.browserSetBounds?.(updatedBounds);
                  } catch {}
                }
              }
            }, BOUNDS_UPDATE_DELAY_MS);
          } catch {}
        }
      }
    });

    const onResize = () => {
      const bounds = computeBounds();
      if (bounds && shouldShow && bounds.width > 0 && bounds.height > 0) {
        if (hasBoundsChanged(bounds)) {
          lastBoundsRef.current = bounds;
          try {
            (window as any).electronAPI?.browserSetBounds?.(bounds);
          } catch {}
        }
      }
    };
    window.addEventListener('resize', onResize);
    const ResizeObserverClass = (window as any).ResizeObserver;
    const resizeObserver = ResizeObserverClass ? new ResizeObserverClass(() => onResize()) : null;
    if (resizeObserver && containerRef.current) resizeObserver.observe(containerRef.current);

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
        resizeObserver?.disconnect?.();
      } catch {}
    };
  }, [isOpen, url, computeBounds, overlayActive, overlayRaised, hasBoundsChanged, taskId]);

  React.useEffect(() => {
    if (isOpen && !url) setAddress('');
  }, [isOpen, url]);

  const lastUrlRef = React.useRef<string | null>(null);
  const lastTaskIdRef2 = React.useRef<string | null | undefined>(null);
  React.useEffect(() => {
    if (taskId !== lastTaskIdRef2.current) {
      lastUrlRef.current = null;
      lastTaskIdRef2.current = taskId || null;
      lastTaskUrlRef.current = null;
    }

    if (isOpen && url && !overlayActive && !overlayRaised && taskId) {
      const taskUrlKey = `${taskId}:${url}`;
      // Force reload if task changed or URL changed
      const isTaskChange = lastTaskUrlRef.current === null;
      if (lastTaskUrlRef.current !== taskUrlKey || lastUrlRef.current !== url) {
        lastUrlRef.current = url;
        lastTaskUrlRef.current = taskUrlKey;

        try {
          (window as any).electronAPI?.browserClear?.();
        } catch {}

        const timeoutId = setTimeout(() => {
          try {
            // Force reload when task changes to ensure fresh content
            (window as any).electronAPI?.browserLoadURL?.(url, isTaskChange);
          } catch {}
        }, URL_LOAD_DELAY_MS);
        return () => clearTimeout(timeoutId);
      }
    }
  }, [isOpen, url, overlayActive, overlayRaised, taskId]);

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
      const dx = startX - e.clientX;
      const viewportWidth = Math.max(1, window.innerWidth);
      const deltaPct = (dx / viewportWidth) * 100;
      setWidthPct(clamp(startPct + deltaPct, WIDTH_PCT_MIN, WIDTH_PCT_MAX));
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

  const handleRefresh = React.useCallback(() => {
    if (!url) return;
    try {
      // Clear and reload to force fresh content
      (window as any).electronAPI?.browserClear?.();
      setTimeout(() => {
        try {
          (window as any).electronAPI?.browserLoadURL?.(url, true);
        } catch {}
      }, 100);
    } catch {}
  }, [url]);

  const handleClose = React.useCallback(async () => {
    void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
      captureTelemetry('browser_preview_closed');
    });
    try {
      const id = (taskId || '').trim();
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
  }, [taskId, clearUrl, close]);

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
        <div className="flex flex-shrink-0 items-center gap-1 border-b border-border bg-gray-50 px-2 dark:bg-gray-900">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => goBack()}
            disabled
            title="Back"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => goForward()}
            disabled
            title="Forward"
            aria-label="Forward"
          >
            <ArrowRight className="h-4 w-4" />
          </Button>
          {url && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleRefresh}
              title="Refresh"
              aria-label="Refresh"
            >
              <RotateCw className="h-4 w-4" />
            </Button>
          )}
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
              {DEFAULT_PREVIEW_URLS.map((previewUrl) => (
                <button
                  key={previewUrl}
                  type="button"
                  className="inline-flex items-center rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                  onClick={() => navigate(previewUrl)}
                >
                  {previewUrl.replace('http://', '')}
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
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-1"
            onClick={handleClose}
            title="Close"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        {!busy && url && lines.length > 0 && (
          <div className="flex flex-shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-2 py-1 text-xs">
            <span className="font-medium">Task Preview</span>
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
          {busy && !url ? (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
              <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-background/95 px-4 py-3 text-sm text-muted-foreground shadow-sm backdrop-blur-[1px]">
                <Spinner size="md" />
                <div className="leading-tight">
                  <div className="font-medium text-foreground">Loading preview…</div>
                  <div className="text-xs text-muted-foreground/80">Starting dev server</div>
                </div>
              </div>
            </div>
          ) : null}
          {url && failed && !busy ? (
            <div className="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-background/80 backdrop-blur-[1px]">
              <div className="flex flex-col items-center gap-3 rounded-xl border border-border/70 bg-background/95 px-4 py-3 text-sm text-muted-foreground shadow-sm">
                <div className="text-center leading-tight">
                  <div className="font-medium text-foreground">Preview unavailable</div>
                  <div className="mt-1 text-xs text-muted-foreground/80">
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
