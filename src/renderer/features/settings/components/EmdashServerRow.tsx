import { PencilIcon, ServerIcon, Trash2Icon } from 'lucide-react';
import type { EmdashServerConnection } from '@main/core/settings/schema';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';

export function EmdashServerRow({
  server,
  onEdit,
  onDelete,
}: {
  server: EmdashServerConnection;
  onEdit: (server: EmdashServerConnection) => void;
  onDelete: (server: EmdashServerConnection) => void;
}) {
  return (
    <div className="flex min-w-0 items-start gap-4 rounded-lg border border-border bg-background p-4">
      <div className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-md text-foreground-muted">
        <ServerIcon className="size-4" />
      </div>
      <div className="grid min-w-0 flex-1 gap-1">
        <h4 className="min-w-0 truncate text-sm font-medium text-foreground">{server.label}</h4>
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
