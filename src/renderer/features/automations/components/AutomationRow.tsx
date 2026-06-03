import { Clock } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import {
  getProjectStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';
import { AbsoluteTime } from '@renderer/lib/ui/absolute-time';
import { Switch } from '@renderer/lib/ui/switch';
import { cn } from '@renderer/utils/utils';
import { formatTriggerLabel } from '@shared/automations/format';
import type { Automation, AutomationRun } from '@shared/automations/types';

interface AutomationRowProps {
  automation: Automation;
  recentRuns?: AutomationRun[];
  onEdit: (automation: Automation) => void;
  onToggleEnabled?: (automation: Automation, enabled: boolean) => void;
}

export const AutomationRow = observer(function AutomationRow({
  automation,
  recentRuns,
  onEdit,
  onToggleEnabled,
}: AutomationRowProps) {
  const isDetached = automation.projectId == null;
  const projectName = automation.projectId
    ? projectDisplayName(getProjectStore(automation.projectId))
    : null;

  const latestRun = recentRuns && recentRuns.length > 0 ? recentRuns[0] : null;
  const latestRunAt =
    latestRun?.startedAt ?? latestRun?.scheduledAt ?? latestRun?.finishedAt ?? null;
  const triggerLabel = formatTriggerLabel(automation.trigger);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onEdit(automation)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onEdit(automation);
      }}
      aria-label={`Edit ${automation.name}`}
      className="group flex cursor-pointer items-center gap-4 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-background-1 focus:outline-none focus-visible:outline-none"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {automation.name}
          </span>
          {automation.isDraft ? (
            <span className="text-muted-foreground shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase">
              Draft
            </span>
          ) : projectName ? (
            <span
              className={cn(
                'text-muted-foreground shrink-0 truncate text-xs font-normal',
                isDetached && 'text-destructive/80'
              )}
            >
              {projectName}
            </span>
          ) : isDetached ? (
            <span className="text-destructive/80 shrink-0 text-xs">No project</span>
          ) : null}
        </div>

        <div className="text-muted-foreground flex items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-3 shrink-0" />
            {triggerLabel}
          </span>
          {latestRunAt && (
            <AbsoluteTime value={latestRunAt} className="min-w-0 truncate" />
          )}
        </div>
      </div>

      <div
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Switch
          size="sm"
          checked={automation.enabled && !automation.isDraft}
          disabled={automation.isDraft || isDetached}
          onCheckedChange={(checked) => onToggleEnabled?.(automation, checked)}
          aria-label={automation.enabled ? 'Pause automation' : 'Enable automation'}
        />
      </div>
    </div>
  );
});
