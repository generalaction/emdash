import type { AgentStatus } from '@renderer/core/stores/conversation-manager';
import { CLISpinner } from '@renderer/core/tasks/components/cliSpinner';
import { cn } from '@renderer/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

export type AgentIndicatorStatus = AgentStatus | null;

interface AgentStatusIndicatorProps {
  status: AgentIndicatorStatus;
  className?: string;
  disableTooltip?: boolean;
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
  disableTooltip,
}: AgentStatusIndicatorProps) {
  if (!status || status === 'idle') return null;

  const renderIndicator = () => {
    switch (status) {
      case 'working':
        return <CLISpinner />;
      case 'awaiting-input':
        return (
          <span
            className={cn('rounded-full bg-blue-200 border size-2 border-blue-500', className)}
            aria-label="Agent is awaiting input"
            title="Agent is awaiting input"
          />
        );
      case 'error':
        return (
          <span
            className={cn('rounded-full bg-red-200 border size-2 border-red-500', className)}
            aria-label="Agent error"
            title="Agent error"
          />
        );
      case 'completed':
        return (
          <span
            className={cn('rounded-full bg-green-200 border size-2 border-green-500', className)}
            aria-label="Agent completed"
            title="Agent completed"
          />
        );
      default:
        return null;
    }
  };

  const indicator = (
    <span className="size-6 flex items-center justify-center">{renderIndicator()}</span>
  );

  if (disableTooltip) return indicator;

  return (
    <Tooltip>
      <TooltipTrigger render={indicator} />
      <TooltipContent>{STATUS_LABELS[status]}</TooltipContent>
    </Tooltip>
  );
}
