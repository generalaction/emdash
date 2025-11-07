import React, { useEffect } from 'react';
import { Globe } from 'lucide-react';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { useBrowser } from '@/providers/BrowserProvider';

interface Props {
  defaultUrl?: string;
  workspaceId?: string | null;
  workspacePath?: string | null;
  parentProjectPath?: string | null;
}

const BrowserToggleButton: React.FC<Props> = ({ defaultUrl, workspaceId, workspacePath, parentProjectPath }) => {
  const browser = useBrowser();
  async function needsInstall(path?: string | null): Promise<boolean> {
    const p = (path || '').trim();
    if (!p) return false;
    try {
      const res = await (window as any).electronAPI?.fsList?.(p, { includeDirs: true, maxEntries: 2000 });
      const items = Array.isArray(res?.items) ? res.items : [];
      const hasNodeModules = items.some((x: any) => x?.path === 'node_modules' && x?.type === 'dir');
      if (hasNodeModules) return false;
      const pkg = await (window as any).electronAPI?.fsRead?.(p, 'package.json', 1024 * 64);
      return !!pkg?.success;
    } catch {
      return false;
    }
  }

  // Auto-open when host preview emits a URL for this workspace
  useEffect(() => {
    const off = (window as any).electronAPI?.onHostPreviewEvent?.((data: any) => {
      try {
        if (data?.type === 'url' && data?.workspaceId && data?.url) {
          if (workspaceId && data.workspaceId !== workspaceId) return;
          const appPort = Number(window.location.port || 0);
          try {
            const p = Number(new URL(String(data.url)).port || 0);
            if (appPort !== 0 && p === appPort) return;
          } catch {}
          browser.open(String(data.url));
          try {
            if (workspaceId) {
              localStorage.setItem(`emdash:browser:lastUrl:${workspaceId}`, String(data.url));
              localStorage.setItem(`emdash:preview:running:${workspaceId}`, '1');
            }
          } catch {}
        }
        if (data?.type === 'setup' && data?.workspaceId && data?.status === 'done') {
          if (workspaceId && data.workspaceId !== workspaceId) return;
          try { if (workspaceId) localStorage.setItem(`emdash:preview:installed:${workspaceId}`, '1'); } catch {}
        }
      } catch {}
    });
    return () => { try { off?.(); } catch {} };
  }, [browser, workspaceId]);

  const isReachable = async (u?: string | null, timeoutMs = 900): Promise<boolean> => {
    const url = (u || '').trim();
    if (!url) return false;
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), timeoutMs);
      await fetch(url, { method: 'GET', mode: 'no-cors', signal: c.signal });
      clearTimeout(t);
      return true;
    } catch {
      return false;
    }
  };

  const handleClick = React.useCallback(async () => {
    const id = (workspaceId || '').trim();
    const wp = (workspacePath || '').trim();
    const appPort = Number(window.location.port || 0);
    // Open pane immediately with no URL; we will navigate when ready
    browser.setBusy(true);
    browser.toggle(undefined);

    if (id) {
      try {
        const last = localStorage.getItem(`emdash:browser:lastUrl:${id}`);
        const running = localStorage.getItem(`emdash:preview:running:${id}`) === '1';
        let openedFromLast = false;
        if (last) {
          const p = Number(new URL(last).port || 0);
          const portClashesWithApp = appPort !== 0 && p === appPort;
          const reachable = !portClashesWithApp && (await isReachable(last));
          if (reachable) {
            browser.open(last);
            openedFromLast = true;
          }
          if (running && !reachable) {
            try { localStorage.removeItem(`emdash:preview:running:${id}`); } catch {}
          }
        }
        if (openedFromLast) browser.setBusy(false);
      } catch {}
    }

    // Auto-run: setup (if needed) + start, then probe common ports; also rely on URL events
    if (id && wp) {
      try {
        const installed = localStorage.getItem(`emdash:preview:installed:${id}`) === '1';
        // If install needed, run setup first (only when sentinel not present)
        if (!installed && await needsInstall(wp)) {
          await (window as any).electronAPI?.hostPreviewSetup?.({ workspaceId: id, workspacePath: wp });
        }
        const running = localStorage.getItem(`emdash:preview:running:${id}`) === '1';
        if (!running) {
          await (window as any).electronAPI?.hostPreviewStart?.({ workspaceId: id, workspacePath: wp, parentProjectPath: (parentProjectPath || '').trim() });
        }
        // Fallback: if no URL event yet after a short delay, try default dev port once.
        setTimeout(async () => {
          try {
            const candidate = 'http://localhost:5173';
            // Avoid the app's own port
            const p = Number(new URL(candidate).port || 0);
            if (appPort !== 0 && p === appPort) return;
            if (await isReachable(candidate)) {
              browser.open(candidate);
              try {
                localStorage.setItem(`emdash:browser:lastUrl:${id}`, candidate);
                localStorage.setItem(`emdash:preview:running:${id}`, '1');
              } catch {}
              browser.setBusy(false);
            }
          } catch {}
        }, 5000);
      } catch {}
    }
    // Fallback: clear spinner after a grace period if nothing arrives
    setTimeout(() => browser.setBusy(false), 15000);
  }, [browser, workspaceId, workspacePath, parentProjectPath]);

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Toggle in-app browser"
            onClick={handleClick}
            className="h-8 w-8 text-muted-foreground hover:bg-background/80"
          >
            <Globe className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs font-medium">
          In‑app Browser
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default BrowserToggleButton;
