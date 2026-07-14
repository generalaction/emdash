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
  hideStatusOnRowInteraction?: boolean;
}

export function RunMetaLine({
  displayTime,
  triggerKind,
  runStatus,
  error,
  hideStatusOnRowInteraction,
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
      <div
        className={cn(
          'shrink-0',
          hideStatusOnRowInteraction &&
            'transition-opacity group-focus-within:pointer-events-none group-focus-within:opacity-0 group-hover:pointer-events-none group-hover:opacity-0'
        )}
      >
        <RunStatusBadge status={runStatus} error={error} />
      </div>
    </div>
  );
}
