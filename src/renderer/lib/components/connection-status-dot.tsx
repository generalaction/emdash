import type { ConnectionState } from '@shared/ssh';
import { cn } from '@renderer/utils/utils';

export function ConnectionStatusDot({ state }: { state: ConnectionState | null }) {
  if (!state) return null;
  return (
    <span
      className={cn('h-1.5 w-1.5 shrink-0 rounded-full', {
        'bg-foreground-success': state === 'connected',
        'bg-foreground-info': state === 'connecting' || state === 'reconnecting',
        'bg-foreground-error': state === 'disconnected' || state === 'error',
      })}
      aria-label={`Connection ${state}`}
      title={`Connection ${state}`}
    />
  );
}
