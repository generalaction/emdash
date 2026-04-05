import { Loader2 } from 'lucide-react';
import type { AgentStatus } from '@renderer/core/stores/conversation-manager';
import { cn } from '@renderer/lib/utils';

export type AgentIndicatorStatus = AgentStatus | null;

interface AgentStatusIndicatorProps {
  status: AgentIndicatorStatus;
  className?: string;
  dotClassName?: string;
  spinnerClassName?: string;
}

export function AgentStatusIndicator({
  status,
  className,
  dotClassName = 'size-2',
  spinnerClassName = 'size-3',
}: AgentStatusIndicatorProps) {
  if (!status || status === 'idle') return null;

  if (status === 'working') {
    return (
      <Loader2
        className={cn('animate-spin text-foreground/60', spinnerClassName, className)}
        aria-label="Agent is working"
      />
    );
  }

  if (status === 'awaiting-input') {
    return (
      <span
        className={cn('rounded-full bg-blue-500', dotClassName, className)}
        aria-label="Agent is awaiting input"
        title="Agent is awaiting input"
      />
    );
  }

  if (status === 'error') {
    return (
      <span
        className={cn('rounded-full bg-red-500', dotClassName, className)}
        aria-label="Agent error"
        title="Agent error"
      />
    );
  }

  return (
    <span
      className={cn('rounded-full bg-green-500', dotClassName, className)}
      aria-label="Agent completed"
      title="Agent completed"
    />
  );
}
