import React, { useEffect } from 'react';
import { Globe } from 'lucide-react';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { useBrowser } from '@/providers/BrowserProvider';
import {
  getLastUrl,
  setLastUrl,
  isRunning,
  setRunning,
  isInstalled,
  setInstalled,
} from '@/lib/previewStorage';
import { isReachable, isAppPort, FALLBACK_DELAY_MS, SPINNER_MAX_MS } from '@/lib/previewNetwork';

interface Props {
  defaultUrl?: string;
  workspaceId?: string | null;
  workspacePath?: string | null;
  parentProjectPath?: string | null;
}

const BrowserToggleButton: React.FC<Props> = ({
  workspaceId,
  workspacePath,
  parentProjectPath,
}) => {
  const browser = useBrowser();
  async function needsInstall(path?: string | null): Promise<boolean> {
    const p = (path || '').trim();
    if (!p) return false;
    try {
      const res = await (window as any).electronAPI?.fsList?.(p, {
        includeDirs: true,
        maxEntries: 2000,
      });
      const items = Array.isArray(res?.items) ? res.items : [];
      const hasNodeModules = items.some(
        (x: any) => x?.path === 'node_modules' && x?.type === 'dir'
      );
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
          if (isAppPort(String(data.url), appPort)) return;
          browser.open(String(data.url));
          try {
            if (workspaceId) {
              setLastUrl(workspaceId, String(data.url));
              setRunning(workspaceId, true);
            }
          } catch {}
        }
        if (data?.type === 'setup' && data?.workspaceId && data?.status === 'done') {
          if (workspaceId && data.workspaceId !== workspaceId) return;
          try {
            if (workspaceId) setInstalled(workspaceId, true);
          } catch {}
        }
        if (data?.type === 'exit' && data?.workspaceId) {
          if (workspaceId && data.workspaceId !== workspaceId) return;
          try {
            if (workspaceId) setRunning(workspaceId, false);
          } catch {}
        }
      } catch {}
    });
    return () => {
      try {
        off?.();
      } catch {}
    };
  }, [browser, workspaceId]);

  const handleClick = React.useCallback(async () => {
    const id = (workspaceId || '').trim();
    const wp = (workspacePath || '').trim();
    const appPort = Number(window.location.port || 0);
    // Open pane immediately with no URL; we will navigate when ready
    browser.showSpinner();
    browser.toggle(undefined);

    if (id) {
      try {
        const last = getLastUrl(id);
        const running = isRunning(id);
        let openedFromLast = false;
        if (last) {
          const portClashesWithApp = isAppPort(last, appPort);
          const reachable = !portClashesWithApp && (await isReachable(last));
          if (reachable) {
            browser.open(last);
            openedFromLast = true;
          }
          if (running && !reachable) {
            try {
              setRunning(id, false);
            } catch {}
          }
        }
        if (openedFromLast) browser.hideSpinner();
      } catch {}
    }

    // Auto-run: setup (if needed) + start, then probe common ports; also rely on URL events
    if (id && wp) {
      try {
        const installed = isInstalled(id);
        // If install needed, run setup first (only when sentinel not present)
        if (!installed && (await needsInstall(wp))) {
          await (window as any).electronAPI?.hostPreviewSetup?.({
            workspaceId: id,
            workspacePath: wp,
          });
          setInstalled(id, true);
        }
        const running = isRunning(id);
        if (!running) {
          await (window as any).electronAPI?.hostPreviewStart?.({
            workspaceId: id,
            workspacePath: wp,
            parentProjectPath: (parentProjectPath || '').trim(),
          });
        }
        // Fallback: if no URL event yet after a short delay, try default dev port once.
        setTimeout(async () => {
          try {
            const candidate = 'http://localhost:5173';
            // Avoid the app's own port
            if (isAppPort(candidate, appPort)) return;
            if (await isReachable(candidate)) {
              browser.open(candidate);
              try {
                setLastUrl(id, candidate);
                setRunning(id, true);
              } catch {}
              browser.hideSpinner();
            }
          } catch {}
        }, FALLBACK_DELAY_MS);
      } catch {}
    }
    // Fallback: clear spinner after a grace period if nothing arrives
    setTimeout(() => browser.hideSpinner(), SPINNER_MAX_MS);
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
