import type { EmdashServerConnection } from '@main/core/settings/schema';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { type ServerStatus, useServerStatus } from '@renderer/features/settings/components/useServerStatus';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';

const STATUS_LABEL: Record<ServerStatus, string> = {
  checking: 'Checking…',
  online: 'Online',
  auth_error: 'Wrong API key',
  offline: 'Unreachable',
};

function ServerDot({ server }: { server: EmdashServerConnection }) {
  const status = useServerStatus(server);
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className={cn(
                'size-1.5 rounded-full shrink-0 cursor-default',
                status === 'online' && 'bg-foreground-success',
                status === 'auth_error' && 'bg-amber-500',
                status === 'offline' && 'bg-destructive',
                status === 'checking' && 'bg-foreground-muted animate-pulse'
              )}
            />
          }
        />
        <TooltipContent>
          {server.label}: {STATUS_LABEL[status]}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function ServerStatusIndicator() {
  const { value: servers } = useAppSettingsKey('rundashServers');

  if (!servers || !Array.isArray(servers) || servers.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      {(servers as EmdashServerConnection[]).map((server) => (
        <ServerDot key={server.id} server={server} />
      ))}
    </div>
  );
}
