import { CirclePause, CirclePlay, Loader2, Play, Trash2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import type { Automation } from '@shared/automations/types';

interface AutomationPanelHeaderProps {
  isEdit: boolean;
  automation: Automation | undefined;
  scheduleLabel?: string;
  onClose: () => void;
  onRunNow?: () => void;
  onToggleEnabled?: (enabled: boolean) => void;
  onDelete?: () => void;
  runNowPending?: boolean;
  headerAction?: ReactNode;
}

export function AutomationPanelHeader({
  isEdit,
  automation,
  scheduleLabel,
  onClose,
  onRunNow,
  onToggleEnabled,
  onDelete,
  runNowPending,
  headerAction,
}: AutomationPanelHeaderProps) {
  const enabled = automation?.enabled ?? false;
  const showSubtitle = isEdit && automation && !automation.isDraft && scheduleLabel;

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-col">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="min-w-0 truncate text-sm font-semibold">
              {automation?.isDraft
                ? 'Draft automation'
                : isEdit
                  ? (automation?.name ?? 'Automation')
                  : 'New automation'}
            </h2>
            {isEdit && automation && !automation.isDraft ? (
              <span
                aria-label={enabled ? 'Active' : 'Paused'}
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  enabled ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                )}
              />
            ) : null}
          </div>
          {showSubtitle ? (
            <span className="text-muted-foreground truncate text-[11px]">{scheduleLabel}</span>
          ) : null}
        </div>
      </div>

      {!isEdit && headerAction ? <div className="flex items-center">{headerAction}</div> : null}

      {isEdit && automation ? (
        <div className="flex items-center gap-0.5">
          {onRunNow ? (
            <Tooltip>
              <TooltipTrigger
                onClick={onRunNow}
                disabled={runNowPending}
                aria-label="Run now"
                className="text-muted-foreground hover:bg-muted rounded-md p-1.5 transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                {runNowPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4" />
                )}
              </TooltipTrigger>
              <TooltipContent>Run now</TooltipContent>
            </Tooltip>
          ) : null}
          {onToggleEnabled ? (
            <Tooltip>
              <TooltipTrigger
                onClick={() => onToggleEnabled(!enabled)}
                aria-label={enabled ? 'Pause schedule' : 'Resume schedule'}
                className="text-muted-foreground hover:bg-muted rounded-md p-1.5 transition-colors hover:text-foreground"
              >
                {enabled ? <CirclePause className="size-4" /> : <CirclePlay className="size-4" />}
              </TooltipTrigger>
              <TooltipContent>
                {enabled ? 'Pause schedule (no new runs)' : 'Resume schedule'}
              </TooltipContent>
            </Tooltip>
          ) : null}
          {onDelete ? (
            <>
              <span aria-hidden className="mx-1 h-4 w-px bg-border" />
              <Tooltip>
                <TooltipTrigger
                  onClick={onDelete}
                  aria-label="Delete automation"
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive rounded-md p-1.5 transition-colors"
                >
                  <Trash2 className="size-4" />
                </TooltipTrigger>
                <TooltipContent>Delete</TooltipContent>
              </Tooltip>
            </>
          ) : null}
        </div>
      ) : null}
              <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="text-muted-foreground hover:bg-muted rounded-md p-1 transition-colors hover:text-foreground"
        >
          <X className="size-4" />
        </button>
    </div>
  );
}
