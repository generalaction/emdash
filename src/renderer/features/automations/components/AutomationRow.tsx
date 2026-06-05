import { Clock, Folder } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import {
  getProjectStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';
import { Switch } from '@renderer/lib/ui/switch';
import { cn } from '@renderer/utils/utils';
import { Automation } from '@shared/automations/automation';

interface AutomationRowProps {
  automation: Automation;
  onToggleEnabled?: (enabled: boolean) => void;
  onClick?: () => void;
}

export const AutomationRow = observer(function AutomationRow({
  automation,
  onToggleEnabled,
  onClick,
}: AutomationRowProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      className="group flex cursor-pointer items-center gap-4 rounded-lg px-4 py-3 text-left transition-colors hover:bg-background-1 focus:outline-none focus-visible:outline-none"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className="flex flex-row items-center justify-end gap-3"
      >
        <Switch checked={automation.enabled} onCheckedChange={(checked) => onToggleEnabled?.(checked)} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="min-w-0 truncate text-sm text-foreground">{automation.name}</span>
          <div className="flex flex-row items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3 shrink-0" />
              {automation.triggerConfig?.expr}
            </span>
            <div className="flex max-w-32 flex-row items-center gap-1.5 rounded-md bg-background-1 px-2 py-1 text-foreground-muted group-hover:bg-background-2">
              <Folder className="size-3 shrink-0" />
              <span
                className={cn(
                  'truncate text-xs font-normal min-w-0',
                  automation.projectId == null && 'text-destructive/80'
                )}
              >
                {automation.projectId
                  ? projectDisplayName(getProjectStore(automation.projectId))
                  : null}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-foreground-muted">
          <span className="inline-flex items-center gap-1.5">Last run at TODO</span>
        </div>
      </div>
    </div>
  );
});
