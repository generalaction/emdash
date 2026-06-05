import { CheckCircle2, Clock, Loader2, MinusCircle, XCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import type { AutomationRunStatus } from '@shared/automations/automation-run';
import { formatRunError } from '@shared/automations/format';

interface RunStatusBadgeProps {
  status: AutomationRunStatus | null;
  error: string | null;
}

const BASE = 'flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs';

const PROGRESS_LABELS: Partial<Record<AutomationRunStatus, string>> = {
  creating_task: 'Creating task',
  launching_task: 'Launching task',
  creating_conversation: 'Starting agent',
};

export function RunStatusBadge({ status, error }: RunStatusBadgeProps) {
  if (!status || status === 'scheduled') return null;

  if (status === 'done') {
    return (
      <span className={cn(BASE, 'bg-background-success text-foreground-success')}>
        <CheckCircle2 className="size-3" />
        Task created
      </span>
    );
  }

  if (status === 'failed') {
    const badge = (
      <span className={cn(BASE, 'bg-destructive/10 text-destructive')}>
        <XCircle className="size-3" />
        Failed
      </span>
    );
    if (!error) return badge;
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span className={cn(BASE, 'bg-destructive/10 text-destructive cursor-default')} />
          }
        >
          <XCircle className="size-3" />
          Failed
        </TooltipTrigger>
        <TooltipContent>{formatRunError(error)}</TooltipContent>
      </Tooltip>
    );
  }

  if (status === 'queued') {
    return (
      <span className={cn(BASE, 'bg-background-info text-foreground-info')}>
        <Clock className="size-3" />
        Queued
      </span>
    );
  }

  if (status === 'skipped') {
    return (
      <span className={cn(BASE, 'bg-background-3 text-muted-foreground')}>
        <MinusCircle className="size-3" />
        Skipped
      </span>
    );
  }

  const progressLabel = PROGRESS_LABELS[status];
  if (!progressLabel) return null;

  return (
    <span className={cn(BASE, 'bg-background-3 text-foreground-muted')}>
      <Loader2 className="size-3 animate-spin" />
      {progressLabel}
    </span>
  );
}
