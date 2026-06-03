import { Ban, ChevronDown, ExternalLink, Globe, Server } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useRef, useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import type { DevServerStore } from '../stores/dev-server-store';
import { useWorkspaceId } from '../task-view-context';

type ServerRef = {
  projectId?: string;
  scopeId: string;
  terminalId: string;
};

function formatUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return url;
  }
}

function getServerKey(server: ServerRef): string {
  return `${server.projectId ?? ''}:${server.scopeId}:${server.terminalId}`;
}

export const DevServerPills = observer(function DevServerPills({
  projectId,
  taskId,
  devServers,
}: {
  projectId: string;
  taskId: string;
  devServers: DevServerStore;
}) {
  const workspaceId = useWorkspaceId();
  const entries = devServers.entries;
  const [stoppingKey, setStoppingKey] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const setRootRef = useCallback((node: HTMLDivElement | null) => {
    mountedRef.current = node !== null;
  }, []);

  const stopServers = async (servers: ServerRef[], key: string) => {
    if (stoppingKey || servers.length === 0) return;
    setStoppingKey(key);
    try {
      await rpc.terminals.stopDevServers({
        projectId,
        taskId,
        workspaceId,
        servers,
      });
    } catch {
      // Best-effort action; the pills stay visible if the backend cannot stop a server.
    } finally {
      if (mountedRef.current) {
        setStoppingKey(null);
      }
    }
  };

  if (entries.length === 0) return null;

  const firstEntry = entries[0];
  const triggerLabel = formatUrl(firstEntry.url);

  const hiddenServerCount = entries.length - 1;
  const allServerRefs = entries.map(({ projectId, scopeId, terminalId }) => ({
    projectId,
    scopeId,
    terminalId,
  }));

  return (
    <Popover>
      <div
        ref={setRootRef}
        className="flex h-7 max-w-72 min-w-0 items-center overflow-hidden rounded-lg bg-background-info text-xs text-foreground-info shadow-xs ring-1 ring-foreground-info/10 transition-colors hover:bg-background-info-hover"
      >
        <PopoverTrigger
          type="button"
          className="focus-visible:ring-ring/50 flex h-7 shrink-0 items-center gap-1 border-r border-foreground-info/10 px-2 text-foreground-info transition-colors hover:bg-background-info-hover focus-visible:ring-2 focus-visible:outline-none"
          aria-label="Open dev servers menu"
          title="Open dev servers menu"
        >
          <Globe className="size-3.5 shrink-0" />
          <ChevronDown className="size-3 shrink-0" />
        </PopoverTrigger>
        <button
          type="button"
          className="focus-visible:ring-ring/50 flex min-w-0 flex-1 items-center gap-1.5 px-2 text-left transition-colors hover:bg-background-info-hover focus-visible:ring-2 focus-visible:outline-none"
          aria-label={`Open ${formatUrl(firstEntry.url)}`}
          title={firstEntry.url}
          onClick={() => void rpc.app.openExternal(firstEntry.url)}
        >
          <span className="min-w-0 truncate font-medium">{triggerLabel}</span>
          {hiddenServerCount > 0 && (
            <span className="shrink-0 rounded-full bg-background-info-hover px-1.5 text-[10px] leading-4 font-medium tabular-nums">
              +{hiddenServerCount}
            </span>
          )}
          <ExternalLink className="size-3 shrink-0" />
        </button>
      </div>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-64 gap-1 rounded-xl bg-background-quaternary p-2 shadow-lg"
      >
        <div className="px-1.5 pb-1.5">
          <span className="text-sm font-medium text-foreground-muted">Servers</span>
        </div>
        <div className="flex flex-col gap-0.5">
          {entries.map(({ projectId: serverProjectId, scopeId, terminalId, url }) => {
            const key = getServerKey({ projectId: serverProjectId, scopeId, terminalId });
            const isStopping = stoppingKey === key;
            return (
              <div
                key={key}
                className="group/server flex h-8 items-center gap-1.5 rounded-lg px-1.5 text-sm text-foreground transition-colors hover:bg-background-quaternary-1"
              >
                <button
                  type="button"
                  className="focus-visible:ring-ring/50 flex min-w-0 flex-1 items-center gap-1.5 text-left transition-colors hover:text-foreground-info focus-visible:ring-2 focus-visible:outline-none"
                  title={url}
                  onClick={() => void rpc.app.openExternal(url)}
                >
                  <Server className="size-3.5 shrink-0 text-foreground-info" />
                  <span className="truncate">{formatUrl(url)}</span>
                  <ExternalLink className="size-3 shrink-0 text-foreground-passive transition-colors group-hover/server:text-foreground-info" />
                </button>
                <Button
                  variant="outline"
                  size="xs"
                  className="h-7 rounded-lg border-border bg-background px-2.5 text-sm text-foreground hover:border-border-destructive hover:bg-background-destructive hover:text-foreground-destructive"
                  disabled={stoppingKey !== null}
                  onClick={() =>
                    void stopServers([{ projectId: serverProjectId, scopeId, terminalId }], key)
                  }
                >
                  {isStopping ? 'Stopping...' : 'Stop'}
                </Button>
              </div>
            );
          })}
        </div>
        <div className="my-1.5 h-px bg-border" />
        <Button
          variant="destructive"
          size="sm"
          className="border-destructive/50 bg-destructive text-destructive-foreground hover:bg-destructive/90 h-9 w-full gap-1.5 rounded-lg text-sm"
          disabled={stoppingKey !== null}
          onClick={() => void stopServers(allServerRefs, 'all')}
        >
          <Ban className="size-4 shrink-0" />
          {stoppingKey === 'all'
            ? entries.length === 1
              ? 'Stopping server...'
              : 'Stopping servers...'
            : entries.length === 1
              ? 'Stop server'
              : 'Stop all servers'}
        </Button>
      </PopoverContent>
    </Popover>
  );
});
