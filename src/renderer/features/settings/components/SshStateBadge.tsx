import { Badge } from '@renderer/lib/ui/badge';
import { cn } from '@renderer/utils/utils';
import type { ConnectionState } from '@shared/ssh';
import { stateLabel } from './ssh-connection-formatters';

export function SshStateBadge({ state }: { state: ConnectionState }) {
  const isActive = state === 'connected' || state === 'connecting' || state === 'reconnecting';
  const isError = state === 'error';

  return (
    <Badge
      variant={isError ? 'destructive' : 'secondary'}
      className={cn(
        'gap-1.5',
        isActive && 'text-foreground-success',
        state === 'disconnected' && 'text-foreground-muted'
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full bg-foreground-muted',
          isActive && 'bg-foreground-success',
          isError && 'bg-destructive'
        )}
      />
      {stateLabel(state)}
    </Badge>
  );
}
