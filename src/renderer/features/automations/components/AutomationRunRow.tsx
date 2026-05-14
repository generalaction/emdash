import { Bot, ChevronRight, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import {
  formatRunError,
  formatRunName,
  formatRunStatusLabel,
  formatRunTriggerKindLabel,
} from '@shared/automations/format';
import type { Automation, AutomationRun } from '@shared/automations/types';
import {
  getProjectStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';
import { getRegisteredTaskData, getTaskView } from '@renderer/features/tasks/stores/task-selectors';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { getPrimaryTool } from '../automation-tools';

interface AutomationRunRowProps {
  run: AutomationRun;
  automation: Automation | undefined;
  projectId: string;
  title: string;
  extraMetaParts?: ReadonlyArray<string | undefined>;
  showProjectName?: boolean;
  paddingClass?: string;
  onDelete?: (run: AutomationRun) => void;
}

export const AutomationRunRow = observer(function AutomationRunRow({
  run,
  automation,
  projectId,
  title,
  extraMetaParts,
  showProjectName = false,
  paddingClass = 'px-3',
  onDelete,
}: AutomationRunRowProps) {
  const { navigate } = useNavigate();
  const taskId = run.taskId;
  const task = taskId ? getRegisteredTaskData(projectId, taskId) : undefined;
  const interactive = Boolean(taskId && task && !task.archivedAt);
  const hadAgent = Boolean(run.createdTaskId);
  const tooltip = interactive
    ? 'Open agent'
    : hadAgent
      ? 'Agent was deleted'
      : 'This run did not create an agent';

  const status = formatRunStatusLabel(run.status);
  const isFailed = run.status === 'failed';
  const errorMessage = run.error ? formatRunError(run.error) : undefined;
  const tool = getPrimaryTool(automation);
  const projectName = showProjectName ? projectDisplayName(getProjectStore(projectId)) : undefined;

  const runName = formatRunName(run.id);
  const metaParts = [
    projectName,
    ...(extraMetaParts ?? []),
    formatRunTriggerKindLabel(run.triggerKind),
    status,
  ].filter((part): part is string => Boolean(part));

  function handleOpenTask() {
    if (!taskId || !interactive) return;
    const taskView = getTaskView(projectId, taskId);
    taskView?.activateLastTabOfKind('conversation');
    navigate('task', { projectId, taskId });
  }

  const rowClass = cn(
    'group flex min-h-12 items-center gap-4 py-2.5 transition-colors',
    paddingClass
  );

  const rowContent = (
    <>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background text-muted-foreground">
        {tool ? (
          <AgentLogo
            logo={tool.logo}
            alt={tool.label}
            isSvg={tool.isSvg}
            invertInDark={tool.invertInDark}
            className="size-4 rounded-sm"
          />
        ) : (
          <Bot className="size-4" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate text-sm font-medium',
            isFailed ? 'text-destructive' : 'text-foreground'
          )}
        >
          {runName}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {errorMessage ?? title}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        {metaParts.map((part, index) => (
          <span key={`${part}-${index}`} className="flex items-center gap-1.5">
            {index > 0 ? <span className="text-muted-foreground/40">·</span> : null}
            <span>{part}</span>
          </span>
        ))}
        <span className="text-muted-foreground/40">·</span>
        <RelativeTime
          value={run.startedAt ?? run.scheduledAt ?? run.finishedAt ?? Date.now()}
          compact
          ago
        />
      </div>
      <ChevronRight
        className={cn(
          'size-3.5 shrink-0 transition-transform',
          interactive
            ? 'text-muted-foreground/50 group-hover:translate-x-0.5 group-hover:text-foreground'
            : 'text-muted-foreground/20'
        )}
      />
    </>
  );

  const rowElement = (
    <Tooltip>
      <TooltipTrigger render={<div />}>
        {interactive ? (
          <button
            type="button"
            onClick={handleOpenTask}
            className={cn(
              rowClass,
              'w-full text-left hover:bg-muted/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring'
            )}
          >
            {rowContent}
          </button>
        ) : (
          <div className={cn(rowClass, 'cursor-not-allowed opacity-60')}>{rowContent}</div>
        )}
      </TooltipTrigger>
      <TooltipContent side="left">{tooltip}</TooltipContent>
    </Tooltip>
  );

  if (!onDelete) return rowElement;

  return (
    <ContextMenu>
      <ContextMenuTrigger className="block w-full">{rowElement}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem variant="destructive" onClick={() => onDelete(run)}>
          <Trash2 />
          Delete run
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});
