import type { ReactNode } from 'react';
import { AbsoluteTime } from '@renderer/lib/ui/absolute-time';
import { cn } from '@renderer/utils/utils';
import type {
  AutomationRun,
  AutomationRunStatus,
  AutomationRunTriggerKind,
} from '@shared/core/automations/automation-run';
import { formatRunTriggerKindLabel } from '../automation-run-format';
import { RunStatusBadge } from './RunStatusBadge';

export interface RunMetaLineProps {
  displayTime: number | null;
  triggerKind: AutomationRunTriggerKind | null;
  runStatus: AutomationRunStatus | null;
  error: AutomationRun['error'];
  statusAction?: ReactNode;
}

export function RunMetaLine({
  displayTime,
  triggerKind,
  runStatus,
  error,
  statusAction,
}: RunMetaLineProps) {
  const triggerLabel = triggerKind ? formatRunTriggerKindLabel(triggerKind) : null;

  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-foreground-muted">
      <span className="flex-1">
        {displayTime ? (
          <div className="flex items-center gap-2">
            <AbsoluteTime className="text-tiny text-foreground-muted" value={displayTime} />
            <span className="text-foreground-passive">•</span>
            {triggerLabel && (
              <span className="shrink-0 text-tiny text-foreground-passive">{triggerLabel}</span>
            )}
          </div>
        ) : (
          <span>—</span>
        )}
      </span>
      <div className="grid shrink-0 items-center justify-items-end">
        <div
          className={cn(
            'col-start-1 row-start-1',
            statusAction && 'group-focus-within:invisible group-hover:invisible'
          )}
        >
          <RunStatusBadge status={runStatus} error={error} />
        </div>
        {statusAction && (
          <div className="invisible absolute top-1/2 right-2 -translate-y-1/2 group-focus-within:visible group-hover:visible">
            {statusAction}
          </div>
        )}
      </div>
    </div>
  );
}
