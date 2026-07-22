import { Badge } from '@core/primitives/ui/browser/badge';
import { cn } from '@core/primitives/ui/browser/cn';
import type { RemoteMachineServerStatus } from '@core/services/remote-machine/api';

const statusLabels: Record<RemoteMachineServerStatus, string> = {
  'not-installed': 'Not found',
  stopped: 'Stopped',
  booting: 'Booting',
  'shutting-down': 'Shutting Down',
  healthy: 'Healthy',
  failed: 'Error',
};

export function WorkspaceServerBadge({ status }: { status: RemoteMachineServerStatus }) {
  const active = status === 'healthy';
  const pending = status === 'booting' || status === 'shutting-down';
  const failed = status === 'failed';

  return (
    <Badge
      variant={failed ? 'destructive' : 'secondary'}
      className={cn(
        'gap-1.5',
        active && 'text-foreground-success',
        pending && 'text-foreground-info',
        (status === 'not-installed' || status === 'stopped') && 'text-foreground-muted'
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full bg-foreground-muted',
          active && 'bg-foreground-success',
          pending && 'animate-pulse bg-foreground-info',
          failed && 'bg-destructive'
        )}
      />
      {statusLabels[status]}
    </Badge>
  );
}
