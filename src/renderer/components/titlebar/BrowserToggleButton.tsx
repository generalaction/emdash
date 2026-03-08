import { Globe } from 'lucide-react';
import React, { useEffect } from 'react';
import { hostPreviewEventChannel } from '@shared/events/hostPreviewEvents';
import { events, rpc } from '@renderer/lib/ipc';
import {
  FALLBACK_DELAY_MS,
  isAppPort,
  isReachable,
  SPINNER_MAX_MS,
} from '@renderer/lib/previewNetwork';
import {
  getLastUrl,
  isInstalled,
  isRunning,
  setInstalled,
  setLastUrl,
  setRunning,
} from '@renderer/lib/previewStorage';
import { useBrowser } from '@renderer/providers/BrowserProvider';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';

interface Props {
  taskId?: string | null;
  taskPath?: string | null;
  parentProjectPath?: string | null;
}

const BrowserToggleButton: React.FC<Props> = ({ taskId, taskPath, parentProjectPath }) => {
  const browser = useBrowser();
  async function needsInstall(path?: string | null): Promise<boolean> {
    const p = (path || '').trim();
    if (!p) return false;
    try {
      const res = await window.electronAPI.fsList(p, {
        includeDirs: true,
        maxEntries: 2000,
      });
      const items = Array.isArray(res?.items) ? res.items : [];
      const hasNodeModules = items.some((x) => x.path === 'node_modules' && x.type === 'dir');
      if (hasNodeModules) return false;
      const pkg = await rpc.fs.read({ root: p, relPath: 'package.json', maxBytes: 1024 * 64 });
      return !!pkg?.success;
    } catch {
      return false;
    }
  }

  // Auto-open when host preview emits a URL for this task
  useEffect(() => {
    const off = events.on(hostPreviewEventChannel, (data) => {
      try {
        if (data?.type === 'url' && data?.taskId && data?.url) {
          if (taskId && data.taskId !== taskId) return;
          const appPort = Number(window.location.port || 0);
          if (isAppPort(String(data.url), appPort)) return;
          browser.open(String(data.url));
          try {
            if (taskId) {
              setLastUrl(taskId, String(data.url));
              setRunning(taskId, true);
            }
          } catch {}
        }
        if (data?.type === 'setup' && data?.taskId && data?.status === 'done') {
          if (taskId && data.taskId !== taskId) return;
          try {
            if (taskId) setInstalled(taskId, true);
          } catch {}
        }
        if (data?.type === 'exit' && data?.taskId) {
          if (taskId && data.taskId !== taskId) return;
          try {
            if (taskId) setRunning(taskId, false);
          } catch {}
        }
      } catch {}
    });
    return () => off();
  }, [browser, taskId]);

  const handleClick = React.useCallback(async () => {
    if (!browser.isOpen) {
      import('../../lib/telemetryClient').then(({ captureTelemetry }) => {
        captureTelemetry('browser_preview_opened');
      });
    }
    const id = (taskId || '').trim();
    const wp = (taskPath || '').trim();
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
          await rpc.hostPreview.setup({
            taskId: id,
            taskPath: wp,
          });
          setInstalled(id, true);
        }
        const running = isRunning(id);
        if (!running) {
          await rpc.hostPreview.start({
            taskId: id,
            taskPath: wp,
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
  }, [browser, taskId, taskPath, parentProjectPath]);

  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Toggle in-app browser"
            onClick={handleClick}
            className="h-8 w-8 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground"
          >
            <Globe className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs font-medium">
          <div className="flex flex-col gap-1">
            <span>Toggle in-app browser</span>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default BrowserToggleButton;
