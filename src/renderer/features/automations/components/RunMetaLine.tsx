import { CheckCircle2 } from 'lucide-react';
import { statusIndicatorConfig } from '@renderer/features/automations/run-status-styles';
import { AbsoluteTime } from '@renderer/lib/ui/absolute-time';
import { cn } from '@renderer/utils/utils';
import type { AutomationRunStatus, AutomationRunTriggerKind } from '@shared/automations/automation-run';
import { formatRunTriggerKindLabel } from '@shared/automations/format';

export interface RunMetaLineProps {
  displayTime: number | null;
  triggerKind: AutomationRunTriggerKind | null;
  runStatus: AutomationRunStatus | null;
}

export function RunMetaLine({ displayTime, triggerKind, runStatus }: RunMetaLineProps) {
  const triggerLabel = triggerKind ? formatRunTriggerKindLabel(triggerKind) : null;

  const statusContent = (() => {
    if (!runStatus) return null;
    if (runStatus === 'done') {
      return (
        <span className="flex shrink-0 items-center gap-1 text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="size-3" />
          Task created
        </span>
      );
    }
    const config = statusIndicatorConfig(runStatus);
    if (!config) return null;
    return (
      <span className={cn('flex shrink-0 items-center gap-1', config.textClass)}>
        <config.Icon className={cn('size-3', config.spin && 'animate-spin')} />
        {config.label}
      </span>
    );
  })();

  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-foreground-muted">
      <span className="flex-1">
        {displayTime ? <AbsoluteTime className="font-mono text-tiny text-foreground-passive" value={displayTime} /> : <span>—</span>}
      </span>
      {triggerLabel && <span className="shrink-0">Triggered by {triggerLabel}</span>}
      {statusContent}
    </div>
  );
}
