import { PencilIcon, ServerIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { EmdashServerConnection } from '@main/core/settings/schema';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';

type Status = 'checking' | 'online' | 'auth_error' | 'offline';

function useServerStatus(server: EmdashServerConnection): Status {
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch(`${server.url}/api/health`, {
          headers: { Authorization: `Bearer ${server.apiKey}` },
          signal: AbortSignal.timeout(5_000),
        });
        if (cancelled) return;
        if (res.ok) setStatus('online');
        else if (res.status === 401) setStatus('auth_error');
        else setStatus('offline');
      } catch {
        if (!cancelled) setStatus('offline');
      }
    }

    void check();
    const interval = setInterval(() => void check(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [server.url, server.apiKey]);

  return status;
}

const STATUS_LABEL: Record<Status, string> = {
  checking: 'Checking…',
  online: 'Online',
  auth_error: 'Wrong API key',
  offline: 'Unreachable',
};

function StatusBadge({ status }: { status: Status }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        'gap-1.5',
        status === 'online' && 'text-foreground-success',
        status === 'auth_error' && 'text-amber-500',
        (status === 'offline' || status === 'checking') && 'text-foreground-muted'
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          status === 'online' && 'bg-foreground-success',
          status === 'auth_error' && 'bg-amber-500',
          status === 'offline' && 'bg-destructive',
          status === 'checking' && 'bg-foreground-muted animate-pulse'
        )}
      />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function EmdashServerRow({
  server,
  onEdit,
  onDelete,
}: {
  server: EmdashServerConnection;
  onEdit: (server: EmdashServerConnection) => void;
  onDelete: (server: EmdashServerConnection) => void;
}) {
  const status = useServerStatus(server);

  return (
    <div className="flex min-w-0 items-start gap-4 rounded-lg border border-border bg-background p-4">
      <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-md text-foreground-muted">
        <ServerIcon className="size-4" />
      </div>
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h4 className="min-w-0 truncate text-sm font-medium text-foreground">{server.label}</h4>
          <StatusBadge status={status} />
        </div>
        <p className="truncate text-xs text-foreground-passive">{server.url}</p>
        <p className="truncate text-xs text-foreground-passive">
          API key: {server.apiKey.slice(0, 12)}…
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onEdit(server)}
                  aria-label={`Edit ${server.label}`}
                >
                  <PencilIcon className="size-4" />
                </Button>
              }
            />
            <TooltipContent>Edit</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="hover:bg-destructive/10 text-foreground-destructive hover:text-foreground-destructive"
                  onClick={() => onDelete(server)}
                  aria-label={`Remove ${server.label}`}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              }
            />
            <TooltipContent>Remove</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
