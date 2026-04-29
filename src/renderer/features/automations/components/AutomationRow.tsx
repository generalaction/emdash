import { Pencil } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { TaskCreateAction } from '@shared/automations/actions';
import { formatTriggerLabel } from '@shared/automations/format';
import type { Automation } from '@shared/automations/types';
import {
  getProjectStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { agentConfig } from '@renderer/utils/agentConfig';
import { AutomationActionButtons } from './AutomationActionButtons';

function getTaskAction(automation: Automation): TaskCreateAction | undefined {
  return automation.actions.find(
    (action): action is TaskCreateAction => action.kind === 'task.create'
  );
}

interface AutomationRowProps {
  automation: Automation;
  busy?: boolean;
  onEdit: (automation: Automation) => void;
  onDelete: (automation: Automation) => void;
  onRunNow: (automation: Automation) => void;
  onSetEnabled: (automation: Automation, enabled: boolean) => void;
  onShowRuns: (automation: Automation) => void;
}

export const AutomationRow = observer(function AutomationRow({
  automation,
  busy,
  onEdit,
  onDelete,
  onRunNow,
  onSetEnabled,
  onShowRuns,
}: AutomationRowProps) {
  const projectName = projectDisplayName(getProjectStore(automation.projectId));
  const providerId = getTaskAction(automation)?.provider;
  const agentName = providerId ? agentConfig[providerId]?.name : undefined;
  const triggerLabel = formatTriggerLabel(automation.trigger);

  return (
    <div className="group flex w-full items-center gap-3 border-b border-border px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/30">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{automation.name}</div>
        {(projectName || agentName) && (
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            {projectName && <span className="truncate">{projectName}</span>}
            {projectName && agentName && <span className="text-foreground-passive">·</span>}
            {agentName && <span className="truncate">{agentName}</span>}
          </div>
        )}
      </div>

      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
        {triggerLabel}
      </span>

      <Tooltip>
        <TooltipTrigger>
          <button
            type="button"
            onClick={() => onEdit(automation)}
            aria-label={`Edit ${automation.name}`}
            className="rounded-md p-1 text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-foreground group-hover:opacity-100 focus:opacity-100"
          >
            <Pencil className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Edit</TooltipContent>
      </Tooltip>

      <AutomationActionButtons
        automation={automation}
        busy={busy}
        onRunNow={onRunNow}
        onShowRuns={onShowRuns}
        onDelete={onDelete}
        onSetEnabled={onSetEnabled}
      />
    </div>
  );
});
