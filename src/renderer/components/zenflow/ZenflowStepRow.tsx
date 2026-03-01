import React from 'react';
import { CheckCircle2, Circle, Loader2, AlertCircle, Play, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PlanStepData } from '@shared/zenflow/types';

interface ZenflowStepRowProps {
  step: PlanStepData;
  isActive: boolean;
  isNextPending: boolean;
  onClick: () => void;
  onStart: () => void;
  onRetry: () => void;
}

const statusIcon: Record<string, React.ReactNode> = {
  completed: <CheckCircle2 className="h-3 w-3 shrink-0 text-green-500" />,
  running: <Loader2 className="h-3 w-3 shrink-0 animate-spin text-blue-500" />,
  failed: <AlertCircle className="h-3 w-3 shrink-0 text-red-500" />,
  pending: <Circle className="h-3 w-3 shrink-0 text-muted-foreground/40" />,
  paused: <Circle className="h-3 w-3 shrink-0 text-yellow-500" />,
};

const ZenflowStepRow: React.FC<ZenflowStepRowProps> = ({
  step,
  isActive,
  isNextPending,
  onClick,
  onStart,
  onRetry,
}) => {
  const needsAction = step.status === 'failed' || (step.status === 'pending' && isNextPending);

  return (
    <button
      onClick={onClick}
      className={cn(
        'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
        isActive
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
      )}
      aria-current={isActive ? 'true' : undefined}
    >
      {statusIcon[step.status] ?? statusIcon.pending}

      <span className="min-w-0 flex-1 truncate">{step.name}</span>

      {step.status === 'failed' && (
        <span className="shrink-0 text-[10px] font-medium text-orange-500">Action required</span>
      )}

      {isNextPending && step.status === 'pending' && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onStart();
          }}
          className="flex shrink-0 items-center gap-0.5 rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-500 transition-colors hover:bg-blue-500/20"
          title="Start this step"
        >
          <Play className="h-2.5 w-2.5" />
          Start
        </button>
      )}

      {step.status === 'failed' && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRetry();
          }}
          className="flex shrink-0 items-center gap-0.5 rounded bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-medium text-orange-500 transition-colors hover:bg-orange-500/20"
          title="Retry this step"
        >
          <RotateCcw className="h-2.5 w-2.5" />
          Retry
        </button>
      )}
    </button>
  );
};

export default ZenflowStepRow;
