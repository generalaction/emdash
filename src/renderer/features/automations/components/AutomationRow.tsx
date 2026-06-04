import { Clock, Folder } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import {
  useAutomation,
  useAutomationLatestRun,
  useToggleAutomation,
} from '@renderer/features/automations/automations-context';
import {
  getProjectStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';
import { AbsoluteTime } from '@renderer/lib/ui/absolute-time';
import { Switch } from '@renderer/lib/ui/switch';
import { cn } from '@renderer/utils/utils';
import { formatTriggerLabel } from '@shared/automations/format';

interface AutomationRowProps {
  automationId: string;
  onClick?: () => void;
}

export const AutomationRow = observer(function AutomationRow({
  automationId,
  onClick,
}: AutomationRowProps) {
  const automation = useAutomation(automationId);
  const latestRun = useAutomationLatestRun(automationId);
  const toggle = useToggleAutomation();

  if (!automation) return null;

  const isDetached = automation.projectId == null;
  const projectName = automation.projectId
    ? projectDisplayName(getProjectStore(automation.projectId))
    : null;

  const latestRunAt =
    latestRun?.startedAt ?? latestRun?.scheduledAt ?? latestRun?.finishedAt ?? null;
  const triggerLabel = formatTriggerLabel(automation.trigger);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onClick?.();
      }}
      aria-label={`Edit ${automation.name}`}
      className="group flex cursor-pointer items-center gap-4 rounded-lg px-4 py-3 text-left transition-colors hover:bg-background-1 focus:outline-none focus-visible:outline-none"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className="flex flex-row items-center justify-end gap-3"
      >
        <Switch
          checked={automation.enabled && !automation.isDraft}
          disabled={automation.isDraft || isDetached}
          onCheckedChange={(checked) => toggle(automationId, checked)}
          aria-label={automation.enabled ? 'Pause automation' : 'Enable automation'}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 items-center gap-2 justify-between">
          <span className="min-w-0 truncate text-sm text-foreground">{automation.name}</span>
          <div className="flex flex-row items-center gap-2 text-xs">

          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-3 shrink-0" />
            {triggerLabel}
          </span>
          <div className="flex max-w-32 flex-row items-center gap-1.5 rounded-md bg-background-1 px-2 py-1 text-foreground-muted group-hover:bg-background-2">
            <Folder className="size-3 shrink-0" />
            <span
              className={cn(
                'truncate text-xs font-normal min-w-0',
                isDetached && 'text-destructive/80'
              )}
            >
              {projectName}
            </span>
          </div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-foreground-muted">
          <span className="inline-flex items-center gap-1.5">
            Last run at
            {latestRunAt && <AbsoluteTime value={latestRunAt} className="min-w-0 truncate" />}
          </span>
        </div>
      </div>

    </div>
  );
});
