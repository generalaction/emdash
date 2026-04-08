import { Loader2 } from 'lucide-react';
import type { AgentStatus } from '@renderer/core/stores/conversation-manager';
import { cn } from '@renderer/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

export type AgentIndicatorStatus = AgentStatus | null;

interface AgentStatusIndicatorProps {
  status: AgentIndicatorStatus;
  className?: string;
  dotClassName?: string;
  spinnerClassName?: string;
}

const STATUS_LABELS = {
  working: 'Agent is working',
  'awaiting-input': 'Agent is awaiting input',
  error: 'Agent error',
  completed: 'Agent completed',
};

export function AgentStatusIndicator({
  status,
  className,
  dotClassName = 'size-2',
  spinnerClassName = 'size-3',
}: AgentStatusIndicatorProps) {
  if (!status || status === 'idle') return null;

  const renderIndicator = () => {
    switch (status) {
      case 'working':
        return (
          <Loader2
            className={cn('animate-spin text-foreground/60', spinnerClassName, className)}
            aria-label="Agent is working"
          />
        );
      case 'awaiting-input':
        return (
          <span
            className={cn('rounded-full bg-blue-500', dotClassName, className)}
            aria-label="Agent is awaiting input"
            title="Agent is awaiting input"
          />
        );
      case 'error':
        return (
          <span
            className={cn('rounded-full bg-red-500', dotClassName, className)}
            aria-label="Agent error"
            title="Agent error"
          />
        );
      case 'completed':
        return (
          <span
            className={cn('rounded-full bg-green-500', dotClassName, className)}
            aria-label="Agent completed"
            title="Agent completed"
          />
        );
      default:
        return null;
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="size-6 flex items-center justify-center">{renderIndicator()}</span>
        }
      />
      <TooltipContent>{STATUS_LABELS[status]}</TooltipContent>
    </Tooltip>
  );
}
