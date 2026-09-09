import { Tooltip } from '@emdash/ui/react/primitives';
import { CheckCircle2, Clock, Loader2, MinusCircle, XCircle } from 'lucide-react';
import type {
  AutomationRun,
  AutomationRunStatus,
} from '@core/features/automations/api/automation-run';
import { automationsHostStylesContribution } from '@core/features/automations/contributions/host-styles';
import { cn } from '@core/primitives/styling/browser/cn';
import { formatRunError } from '../automation-run-format';

interface RunStatusBadgeProps {
  status: AutomationRun['status'] | null;
  error: AutomationRun['error'];
}

const { automationRunBadge } = automationsHostStylesContribution.exports;

const PROGRESS_LABELS: Partial<Record<AutomationRunStatus, string>> = {
  provisioning_workspace: 'Preparing workspace',
  starting_session: 'Starting agent',
};

export function RunStatusBadge({ status, error }: RunStatusBadgeProps) {
  if (!status || status === 'scheduled') return null;

  if (status === 'done') {
    return (
      <span className={automationRunBadge({ status: 'done' })}>
        <CheckCircle2 className="size-3" />
        Agent started
      </span>
    );
  }

  if (status === 'failed') {
    const badge = (
      <span className={automationRunBadge({ status: 'failed' })}>
        <XCircle className="size-3" />
        Failed
      </span>
    );
    if (!error) return badge;
    return (
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <span className={cn(automationRunBadge({ status: 'failed' }), 'cursor-default')} />
          }
        >
          <XCircle className="size-3" />
          Failed
        </Tooltip.Trigger>
        <Tooltip.Content>{formatRunError(error)}</Tooltip.Content>
      </Tooltip.Root>
    );
  }

  if (status === 'queued') {
    return (
      <span className={automationRunBadge({ status: 'queued' })}>
        <Clock className="size-3" />
        Queued
      </span>
    );
  }

  if (status === 'skipped' || status === 'cancelled') {
    return (
      <span className={automationRunBadge({ status })}>
        <MinusCircle className="size-3" />
        {status === 'cancelled' ? 'Cancelled' : 'Skipped'}
      </span>
    );
  }

  const progressLabel = PROGRESS_LABELS[status];
  if (!progressLabel) return null;

  return (
    <span className={automationRunBadge({ status })}>
      <Loader2 className="size-3 animate-spin" />
      {progressLabel}
    </span>
  );
}
