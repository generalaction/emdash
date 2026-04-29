import { History, Pencil, Play, Trash2 } from 'lucide-react';
import type { Automation } from '@shared/automations/types';
import { Switch } from '@renderer/lib/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';

interface AutomationActionButtonsProps {
  automation: Automation;
  busy?: boolean;
  showEditHint?: boolean;
  onRunNow: (automation: Automation) => void;
  onShowRuns: (automation: Automation) => void;
  onDelete: (automation: Automation) => void;
  onSetEnabled: (automation: Automation, enabled: boolean) => void;
}

export function AutomationActionButtons({
  automation,
  busy,
  showEditHint,
  onRunNow,
  onShowRuns,
  onDelete,
  onSetEnabled,
}: AutomationActionButtonsProps) {
  return (
    <div
      className="flex shrink-0 items-center gap-1 self-center"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Tooltip>
        <TooltipTrigger>
          <button
            type="button"
            onClick={() => onRunNow(automation)}
            disabled={busy}
            aria-label="Run now"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <Play className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Run now</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger>
          <button
            type="button"
            onClick={() => onShowRuns(automation)}
            aria-label="Run history"
            className="rounded-md p-1 text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-foreground group-hover:opacity-100"
          >
            <History className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Run history</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger>
          <button
            type="button"
            onClick={() => onDelete(automation)}
            aria-label="Delete"
            className="rounded-md p-1 text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-destructive group-hover:opacity-100"
          >
            <Trash2 className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Delete</TooltipContent>
      </Tooltip>
      <Switch
        checked={automation.enabled}
        onCheckedChange={(enabled) => onSetEnabled(automation, enabled)}
        aria-label={automation.enabled ? 'Disable automation' : 'Enable automation'}
        className="ml-1"
      />
      {showEditHint && (
        <Pencil className="ml-1 size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </div>
  );
}
