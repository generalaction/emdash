import { Bot, ChevronRight } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo } from 'react';
import githubSvg from '@/assets/images/Github.svg?raw';
import type { ActionSpec } from '@shared/automations/actions';
import { formatRunStatusLabel, formatRunTriggerKindLabel } from '@shared/automations/format';
import type { Automation, AutomationRunWithContext } from '@shared/automations/types';
import {
  getProjectStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';
import { getRegisteredTaskData, getTaskView } from '@renderer/features/tasks/stores/task-selectors';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { Spinner } from '@renderer/lib/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { agentConfig } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import { useAutomations, useRecentAutomationRuns } from '../useAutomations';

const PAGE_LIMIT = 50;

type Tool = {
  label: string;
  logo: string;
  isSvg?: boolean;
  invertInDark?: boolean;
};

function actionTool(action: ActionSpec): Tool | null {
  const cfg = action.provider ? agentConfig[action.provider] : undefined;
  if (!cfg) return null;
  return {
    label: cfg.name,
    logo: cfg.logo,
    isSvg: cfg.isSvg,
    invertInDark: cfg.invertInDark,
  };
}

function primaryTool(automation: Automation | undefined): Tool | null {
  if (!automation) return null;
  for (const action of automation.actions) {
    const tool = actionTool(action);
    if (tool) return tool;
  }
  return null;
}

export function RecentRunsList() {
  const runs = useRecentAutomationRuns(undefined, PAGE_LIMIT);
  const { automations } = useAutomations();

  const automationById = useMemo(() => {
    const map = new Map<string, Automation>();
    for (const automation of automations.data ?? []) {
      map.set(automation.id, automation);
    }
    return map;
  }, [automations.data]);

  if (runs.isPending) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const items = runs.data ?? [];

  if (items.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-muted-foreground">No automation runs yet.</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border/70 border-y border-border/70">
      {items.map((run) => (
        <RecentRunRow key={run.id} run={run} automation={automationById.get(run.automationId)} />
      ))}
    </div>
  );
}

interface RecentRunRowProps {
  run: AutomationRunWithContext;
  automation: Automation | undefined;
}

const RecentRunRow = observer(function RecentRunRow({ run, automation }: RecentRunRowProps) {
  const { navigate } = useNavigate();
  const taskId = run.taskId;
  const task = taskId ? getRegisteredTaskData(run.projectId, taskId) : undefined;
  const interactive = Boolean(taskId && task && !task.archivedAt);
  const tooltip = interactive
    ? 'Open agent'
    : taskId
      ? 'Agent is no longer available'
      : 'This run did not create an agent';

  const projectName = projectDisplayName(getProjectStore(run.projectId));
  const status = formatRunStatusLabel(run.status);
  const isFailed = run.status === 'failed';
  const tool = primaryTool(automation);
  const isGithubTriggered = run.triggerKind === 'event';

  function handleOpenTask() {
    if (!taskId || !interactive) return;
    const taskView = getTaskView(run.projectId, taskId);
    taskView?.setView('agents');
    navigate('task', { projectId: run.projectId, taskId });
  }

  const metaParts = [projectName, formatRunTriggerKindLabel(run.triggerKind), status].filter(
    (part): part is string => Boolean(part)
  );

  const rowContent = (
    <>
      <span className="relative flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background text-muted-foreground">
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
        {isGithubTriggered ? (
          <span className="absolute -bottom-1 -right-1 flex size-3.5 items-center justify-center rounded-full border border-border/70 bg-background text-foreground shadow-sm">
            <AgentLogo logo={githubSvg} alt="GitHub" isSvg className="size-2.5 rounded-full" />
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-sm font-medium',
          isFailed ? 'text-destructive' : 'text-foreground'
        )}
      >
        {run.automationName}
      </span>
      <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        {metaParts.map((part, index) => (
          <span key={`${part}-${index}`} className="flex items-center gap-1.5">
            {index > 0 ? <span className="text-muted-foreground/40">·</span> : null}
            <span>{part}</span>
          </span>
        ))}
        <span className="text-muted-foreground/40">·</span>
        <RelativeTime value={run.startedAt} compact ago />
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

  return (
    <div>
      <Tooltip>
        <TooltipTrigger render={<div />}>
          {interactive ? (
            <button
              type="button"
              onClick={handleOpenTask}
              className="group flex min-h-12 w-full items-center gap-4 px-1 py-2.5 text-left transition-colors hover:bg-muted/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {rowContent}
            </button>
          ) : (
            <div className="flex min-h-12 cursor-not-allowed items-center gap-4 px-1 py-2.5 opacity-60">
              {rowContent}
            </div>
          )}
        </TooltipTrigger>
        <TooltipContent side="left">{tooltip}</TooltipContent>
      </Tooltip>
      {run.error && (
        <p className="mx-1 mb-2 mt-0.5 line-clamp-2 text-xs text-destructive">{run.error}</p>
      )}
    </div>
  );
});
