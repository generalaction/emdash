import { AbsoluteTime } from '@renderer/lib/ui/absolute-time';
import type {
  AutomationRunStatus,
  AutomationRunTriggerKind,
} from '@shared/automations/automation-run';
import { formatRunTriggerKindLabel } from '@shared/automations/format';
import { RunStatusBadge } from './RunStatusBadge';

export interface RunMetaLineProps {
  displayTime: number | null;
  triggerKind: AutomationRunTriggerKind | null;
  runStatus: AutomationRunStatus | null;
  error: string | null;
}

export function RunMetaLine({ displayTime, triggerKind, runStatus, error }: RunMetaLineProps) {
  const triggerLabel = triggerKind ? formatRunTriggerKindLabel(triggerKind) : null;

  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-foreground-muted">
      <span className="flex-1">
        {displayTime ? (
          <div className="flex items-center gap-2">
            <AbsoluteTime
              className="font-mono text-tiny text-foreground-muted"
              value={displayTime}
            />
            <span className="text-foreground-passive">•</span>
            {triggerLabel && (
              <span className="shrink-0 font-mono text-tiny text-foreground-passive">
                {triggerLabel}
              </span>
            )}
          </div>
        ) : (
          <span>—</span>
        )}
      </span>
      <RunStatusBadge status={runStatus} error={error} />
    </div>
  );
}
