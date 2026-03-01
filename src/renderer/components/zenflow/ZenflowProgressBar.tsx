import React from 'react';
import { CheckCircle2, Loader2, PauseCircle, AlertCircle, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PlanStepData, ZenflowWorkflowStatus } from '@shared/zenflow/types';

interface ZenflowProgressBarProps {
  steps: PlanStepData[];
  workflowStatus: ZenflowWorkflowStatus | null;
  onPause: () => void;
  onResume: () => void;
}

const ZenflowProgressBar: React.FC<ZenflowProgressBarProps> = ({
  steps,
  workflowStatus,
  onPause,
  onResume,
}) => {
  const completedCount = steps.filter((s) => s.status === 'completed').length;
  const totalCount = steps.length;
  const runningStep = steps.find((s) => s.status === 'running');

  const statusIcon =
    workflowStatus === 'completed' ? (
      <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
    ) : workflowStatus === 'failed' ? (
      <AlertCircle className="h-3.5 w-3.5 text-red-500" />
    ) : workflowStatus === 'running' ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
    ) : workflowStatus === 'paused' ? (
      <PauseCircle className="h-3.5 w-3.5 text-yellow-500" />
    ) : null;

  const statusText = runningStep
    ? `Step ${runningStep.stepNumber}/${totalCount}: ${runningStep.name}`
    : workflowStatus === 'completed'
      ? `All ${totalCount} steps completed`
      : workflowStatus === 'paused'
        ? `Paused at step ${completedCount}/${totalCount}`
        : workflowStatus === 'failed'
          ? `Failed at step ${completedCount + 1}/${totalCount}`
          : `${completedCount}/${totalCount} steps`;

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-2.5 py-1 text-xs">
      {/* Progress dots */}
      <div className="flex items-center gap-0.5">
        {steps.map((step) => (
          <div
            key={step.stepNumber}
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              step.status === 'completed' && 'bg-green-500',
              step.status === 'running' && 'bg-blue-500',
              step.status === 'failed' && 'bg-red-500',
              step.status === 'pending' && 'bg-muted-foreground/30',
              step.status === 'paused' && 'bg-yellow-500'
            )}
          />
        ))}
      </div>

      {/* Status */}
      <div className="flex items-center gap-1 text-muted-foreground">
        {statusIcon}
        <span>{statusText}</span>
      </div>

      {/* Pause/Resume button */}
      {workflowStatus === 'running' && (
        <button
          onClick={onPause}
          className="ml-auto rounded p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
          title="Pause workflow"
        >
          <PauseCircle className="h-3.5 w-3.5" />
        </button>
      )}
      {(workflowStatus === 'paused' || workflowStatus === 'failed') && (
        <button
          onClick={onResume}
          className="ml-auto rounded p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
          title="Resume workflow"
        >
          <Play className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
};

export default ZenflowProgressBar;
