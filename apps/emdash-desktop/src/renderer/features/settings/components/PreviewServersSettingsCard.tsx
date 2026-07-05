import { ExternalLinkIcon, GlobeIcon, SquareIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import {
  getProjectStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';
import {
  formatPreviewServerLabel,
  previewServerStatusLabel,
} from '@renderer/features/tasks/components/preview-servers/preview-server-format';
import {
  asProvisioned,
  getTaskManagerStore,
  taskDisplayName,
} from '@renderer/features/tasks/stores/task-selectors';
import { events, rpc } from '@renderer/lib/ipc';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { previewServerEventChannel } from '@shared/core/preview-servers/events';
import type { PreviewServer } from '@shared/core/preview-servers/types';
import { previewServerUrl } from '@shared/core/preview-servers/types';

export const PreviewServersSettingsCard = observer(function PreviewServersSettingsCard() {
  const [servers, setServers] = useState<PreviewServer[]>([]);

  useEffect(() => {
    let disposed = false;
    void rpc.previewServers.listAll().then((list) => {
      if (!disposed) setServers(sortServers(list));
    });
    const unsubscribe = events.on(previewServerEventChannel, (event) => {
      setServers((current) => {
        const next = new Map(current.map((server) => [server.id, server]));
        if (event.type === 'upsert') {
          next.set(event.server.id, event.server);
        } else {
          next.delete(event.id);
        }
        return sortServers(Array.from(next.values()));
      });
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-sm font-normal text-foreground">Preview servers</h3>
          <p className="text-xs text-foreground-passive">
            Detected servers and port forwards across all projects and tasks.
          </p>
        </div>
        {servers.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            className="hover:bg-destructive/10 text-foreground-destructive hover:text-foreground-destructive"
            onClick={() => void rpc.previewServers.stopAll()}
          >
            <SquareIcon className="size-3 fill-current" />
            Stop all
          </Button>
        ) : null}
      </div>

      {servers.length === 0 ? (
        <div className="bg-muted/10 flex min-h-32 flex-col items-center justify-center rounded-lg border border-border p-8 text-center">
          <GlobeIcon className="mb-3 size-8 text-foreground-passive" />
          <div className="text-sm text-foreground">No preview servers running</div>
          <p className="mt-1 max-w-sm text-xs text-foreground-passive">
            Servers detected in task terminals and SSH port forwards show up here.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {servers.map((server) => (
            <PreviewServerSettingsRow key={server.id} server={server} />
          ))}
        </div>
      )}
    </div>
  );
});

function ServerActionButton({
  label,
  children,
  disabled,
  className,
  onClick,
}: {
  label: string;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className={className}
              onClick={onClick}
              disabled={disabled}
              aria-label={label}
            >
              {children}
            </Button>
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function PreviewServerStatusBadge({ server }: { server: PreviewServer }) {
  const kind = server.status.kind;
  const isBusy = kind === 'starting' || kind === 'reconnecting';

  return (
    <Badge
      variant={kind === 'failed' ? 'destructive' : 'secondary'}
      className={cn(
        'gap-1.5',
        kind === 'ready' && 'text-foreground-success',
        isBusy && 'text-foreground-warning'
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full bg-foreground-muted',
          kind === 'ready' && 'bg-foreground-success',
          isBusy && 'bg-foreground-warning',
          kind === 'failed' && 'bg-destructive'
        )}
      />
      {previewServerStatusLabel(server)}
    </Badge>
  );
}

const PreviewServerSettingsRow = observer(function PreviewServerSettingsRow({
  server,
}: {
  server: PreviewServer;
}) {
  const url = previewServerUrl(server);
  const canOpen = server.status.kind === 'ready' && url !== null;
  const projectName = projectDisplayName(getProjectStore(server.projectId));
  const taskName = taskNameForWorkspace(server.projectId, server.workspaceId);
  const usedBy = [projectName, taskName].filter(Boolean).join(' · ');
  const label = formatPreviewServerLabel(server);

  return (
    <div className="flex min-w-0 items-start gap-4 rounded-lg border border-border bg-background p-4">
      <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-md text-foreground-muted">
        <GlobeIcon className="size-4" />
      </div>
      <div className="grid min-w-0 flex-1 gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h4 className="min-w-0 truncate text-sm font-medium text-foreground">{label}</h4>
          <PreviewServerStatusBadge server={server} />
        </div>
        <div className="min-w-0 space-y-1 text-xs text-foreground-passive">
          <p className="truncate">{url ?? 'No local URL'}</p>
          {usedBy !== '' ? <p className="truncate">Used by: {usedBy}</p> : null}
          {server.status.kind === 'failed' ? (
            <p className="truncate text-foreground-destructive">{server.status.message}</p>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <ServerActionButton
          label="Open in browser"
          disabled={!canOpen}
          onClick={() => {
            if (canOpen) void rpc.app.openExternal(url);
          }}
        >
          <ExternalLinkIcon className="size-4" />
        </ServerActionButton>
        <ServerActionButton
          label={`Stop ${label}`}
          className="hover:bg-destructive/10 text-foreground-destructive hover:text-foreground-destructive"
          onClick={() => void rpc.previewServers.stop(server.id)}
        >
          <SquareIcon className="size-3 fill-current" />
        </ServerActionButton>
      </div>
    </div>
  );
});

function taskNameForWorkspace(projectId: string, workspaceId: string): string | undefined {
  const manager = getTaskManagerStore(projectId);
  if (!manager) return undefined;
  for (const store of manager.tasks.values()) {
    if (asProvisioned(store)?.workspaceId === workspaceId) return taskDisplayName(store);
  }
  return undefined;
}

function sortServers(servers: PreviewServer[]): PreviewServer[] {
  return [...servers].sort((a, b) => {
    if (a.projectId !== b.projectId) return a.projectId.localeCompare(b.projectId);
    const aPort = a.kind === 'forwarded' ? a.remotePort : a.port;
    const bPort = b.kind === 'forwarded' ? b.remotePort : b.port;
    if (aPort !== bPort) return aPort - bPort;
    return a.id.localeCompare(b.id);
  });
}
