import { Loader2 } from 'lucide-react';
import type { TaskAgentStatus } from '@renderer/core/stores/conversation-manager';
import { cn } from '@renderer/lib/utils';

interface AgentStatusIndicatorProps {
  status: TaskAgentStatus;
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
  if (!status) return null;

  if (status === 'working') {
    return (
      <Loader2
        className={cn('animate-spin text-foreground/60', spinnerClassName, className)}
        aria-label="Agent is working"
      />
    );
  }

  if (status === 'notification') {
    return (
      <span
        className={cn('rounded-full bg-blue-500', dotClassName, className)}
        aria-label="Agent needs attention"
        title="Agent needs attention"
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
