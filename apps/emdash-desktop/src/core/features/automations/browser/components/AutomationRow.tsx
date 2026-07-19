import cronstrue from 'cronstrue';
import {
  CheckCircle2,
  Clock,
  Folder,
  Loader2,
  MinusCircle,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import {
  useLatestAutomationRun,
  useScheduledAutomationRun,
  useAutomationTargetAvailability,
} from '@core/features/automations/browser/use-automations';
import { taskAgentStatus } from '@core/features/conversations/browser/conversation-selectors';
import {
  getProjectStore,
  projectDisplayName,
} from '@core/features/projects/browser/stores/project-selectors';
import {
  getTaskIdForAutomationRun,
  getTaskStore,
} from '@core/features/tasks/browser/stores/task-selectors';
import type { Automation } from '@core/primitives/automations/api';
import type { AutomationRunStatus } from '@core/primitives/automations/api';
import { AgentStatusIndicator } from '@renderer/lib/components/agent-status-indicator';
import { AbsoluteTime } from '@renderer/lib/ui/absolute-time';
import { Switch } from '@renderer/lib/ui/switch';
import { cn } from '@renderer/utils/utils';
import { formatRunTriggerKindLabel } from '../automation-run-format';

const RUN_STATUS_ICON: Record<
  AutomationRunStatus,
  { Icon: LucideIcon; textClass: string; spin?: boolean }
> = {
  scheduled: { Icon: Clock, textClass: 'text-foreground-info' },
  queued: { Icon: Clock, textClass: 'text-foreground-muted' },
  provisioning_workspace: { Icon: Loader2, textClass: 'text-foreground-muted', spin: true },
  starting_session: { Icon: Loader2, textClass: 'text-foreground-muted', spin: true },
  done: { Icon: CheckCircle2, textClass: 'text-foreground-success' },
  failed: { Icon: XCircle, textClass: 'text-foreground-error' },
  skipped: { Icon: MinusCircle, textClass: 'text-foreground-muted' },
  cancelled: { Icon: MinusCircle, textClass: 'text-foreground-muted' },
};

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
  const availability = useAutomationTargetAvailability(automation.projectId);
  const runtimeAvailable = availability.data?.available === true;
  const latestRunQuery = useLatestAutomationRun(automation.id, runtimeAvailable);
  const scheduledRunQuery = useScheduledAutomationRun(automation.id, runtimeAvailable);

  const run = latestRunQuery.data ?? null;
  const scheduledAt = runtimeAvailable ? (scheduledRunQuery.data?.scheduledAt ?? null) : null;

  const projectId = automation.projectId ?? null;
  const taskId = run && projectId ? getTaskIdForAutomationRun(projectId, run.id) : null;
  const taskStore = taskId && projectId ? getTaskStore(projectId, taskId) : undefined;
  const agentStatus = taskStore ? taskAgentStatus(taskStore) : null;

  const expr = automation.triggerConfig?.expr ?? null;
  const cronLabel = expr
    ? (() => {
        try {
          return cronstrue.toString(expr.trim());
        } catch {
          return expr;
        }
      })()
    : null;

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
        <Switch
          checked={automation.enabled}
          disabled={!runtimeAvailable}
          title={availability.data?.available === false ? availability.data.reason : undefined}
          onCheckedChange={(checked) => onToggleEnabled?.(checked)}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {/* Row 1: name + agent indicator left, cron + project right */}
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1">
            <span
              className={cn(
                'min-w-0 truncate text-md',
                automation.enabled ? 'text-foreground' : 'text-foreground-muted'
              )}
            >
              {automation.name}
            </span>
            <AgentStatusIndicator status={agentStatus} />
          </div>
          <div className="flex shrink-0 flex-row items-center gap-1 text-xs text-foreground-muted">
            {cronLabel && (
              <span className="flex items-center gap-1 rounded-md bg-background-1 px-2 py-1 text-foreground-muted group-hover:bg-background-2">
                <Clock className="size-3 shrink-0" />
                <span className="shrink-0">{cronLabel}</span>
              </span>
            )}
            <div className="flex max-w-32 flex-row items-center gap-1.5 rounded-md bg-background-1 px-2 py-1 text-foreground-muted group-hover:bg-background-2">
              <Folder className="size-3 shrink-0" />
              <span
                className={cn(
                  'min-w-0 truncate text-xs font-normal',
                  projectId == null && 'text-destructive/80'
                )}
              >
                {projectId ? projectDisplayName(getProjectStore(projectId)) : 'No project'}
              </span>
            </div>
          </div>
        </div>

        {/* Row 2: latest run sentence left, next run / disabled right */}
        <div className="flex min-w-0 items-center justify-between gap-2">
          {!runtimeAvailable ? (
            <span className="text-sm text-foreground-warning">Remote runtime unavailable</span>
          ) : run ? (
            (() => {
              const { Icon, textClass, spin } = RUN_STATUS_ICON[run.status];
              const time = run.startedAt ?? run.finishedAt;
              return (
                <span className="flex items-center gap-1.5 text-sm text-foreground-muted">
                  <Icon className={cn('size-3.5 shrink-0', textClass, spin && 'animate-spin')} />
                  Last run on
                  {time && <AbsoluteTime value={time} className="text-foreground-muted" />}·{' '}
                  {formatRunTriggerKindLabel(run.triggerKind)}
                </span>
              );
            })()
          ) : (
            <span className="text-sm text-foreground-passive">No runs</span>
          )}

          <div className="shrink-0 text-xs text-foreground-muted">
            {automation.enabled ? (
              scheduledAt ? (
                <span className="flex items-center gap-1">
                  Next run scheduled
                  <AbsoluteTime value={scheduledAt} />
                </span>
              ) : null
            ) : (
              <span className="text-foreground-passive">Disabled</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
