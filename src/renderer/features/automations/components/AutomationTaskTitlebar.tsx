import { Bot, ChevronDown, FileDiff, FolderOpen, MessageSquare, Terminal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { automationTool } from '@renderer/features/automations/automation-tools';
import { useAutomationRuns, useAutomations } from '@renderer/features/automations/useAutomations';
import {
  asMounted,
  getProjectStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';
import { DevServerPills } from '@renderer/features/tasks/components/dev-server-pills';
import {
  getRegisteredTaskData,
  getTaskStore,
  taskViewKind,
} from '@renderer/features/tasks/stores/task-selectors';
import {
  useTaskViewContext,
  useWorkspace,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import type { SidebarTab } from '@renderer/features/tasks/types';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { OpenInMenu } from '@renderer/lib/components/titlebar/open-in-menu';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { AbsoluteTime } from '@renderer/lib/ui/absolute-time';
import { MicroLabel } from '@renderer/lib/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { Separator } from '@renderer/lib/ui/separator';
import { BoundShortcut } from '@renderer/lib/ui/shortcut';
import { Spinner } from '@renderer/lib/ui/spinner';
import { Toggle } from '@renderer/lib/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { formatRunName } from '@shared/automations/format';
import type { Automation, AutomationRun } from '@shared/automations/types';

const AUTOMATION_RUNS_POPOVER_LIMIT = 50;

export const AutomationTaskTitlebar = observer(function AutomationTaskTitlebar() {
  const { projectId, taskId } = useTaskViewContext();
  const { navigate } = useNavigate();
  const { automations } = useAutomations();
  const taskStore = getTaskStore(projectId, taskId);
  const kind = taskViewKind(taskStore, projectId);
  const automationId = taskStore?.data.automationId;
  if (!automationId) return null;

  const ready = kind === 'ready';
  const automation = automations.data?.find((entry) => entry.id === automationId);
  const automationName = automation?.name ?? 'Automation';
  const projectName = projectDisplayName(getProjectStore(projectId));

  return (
    <Titlebar
      leftSlot={
        <div className="flex items-center gap-1 px-2 text-sm text-foreground-muted">
          <button
            type="button"
            className="text-sm text-foreground-passive hover:text-foreground"
            onClick={() => navigate('project', { projectId })}
          >
            {projectName}
          </button>
          <span className="text-sm text-foreground-passive">/</span>
          <button
            type="button"
            title={automation?.name}
            className="max-w-[14rem] truncate text-sm text-foreground-passive hover:text-foreground"
            onClick={() => navigate('automations', { selectedAutomationId: automationId })}
          >
            {automationName}
          </button>
          <span className="text-sm text-foreground-passive">/</span>
          <AutomationRunsPopover
            automationId={automationId}
            automation={automation}
            projectId={projectId}
            currentTaskId={taskId}
          />
        </div>
      }
      rightSlot={
        ready ? <AutomationTitlebarRightSlot projectId={projectId} taskId={taskId} /> : undefined
      }
    />
  );
});

function AutomationRunsPopover({
  automationId,
  automation,
  projectId,
  currentTaskId,
}: {
  automationId: string;
  automation: Automation | undefined;
  projectId: string;
  currentTaskId: string;
}) {
  const [open, setOpen] = useState(false);
  const { navigate } = useNavigate();
  const runs = useAutomationRuns(automationId, AUTOMATION_RUNS_POPOVER_LIMIT);
  const tool = automationTool(automation);
  const currentRun = runs.data?.find((run) => (run.taskId ?? run.createdTaskId) === currentTaskId);

  function handleSelectRun(run: AutomationRun) {
    setOpen(false);
    const targetTaskId = run.taskId ?? run.createdTaskId;
    if (!targetTaskId) return;
    if (targetTaskId === currentTaskId) return;
    navigate('task', { projectId, taskId: targetTaskId });
  }

  function handleOpenAutomation() {
    setOpen(false);
    navigate('automations', { selectedAutomationId: automationId });
  }

  const items = runs.data ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="flex items-center gap-1 text-sm text-foreground-muted hover:text-foreground focus:outline-none">
        <span className="max-w-64 truncate">
          {currentRun ? formatRunName(currentRun.id) : 'Run'}
        </span>
        <ChevronDown className="size-3.5 shrink-0" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-0 p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-1.5">
          <MicroLabel className="text-foreground-passive">Recent runs</MicroLabel>
          <button
            type="button"
            onClick={handleOpenAutomation}
            className="text-xs text-foreground-muted hover:text-foreground hover:underline focus:outline-none"
          >
            Open automation
          </button>
        </div>
        {runs.isPending ? (
          <div className="flex h-20 items-center justify-center">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <div className="text-muted-foreground px-3 py-6 text-center text-xs">No runs yet.</div>
        ) : (
          <div className="max-h-80 overflow-y-auto py-1">
            {items.map((run) => (
              <AutomationRunPopoverItem
                key={run.id}
                run={run}
                projectId={projectId}
                tool={tool}
                isCurrent={(run.taskId ?? run.createdTaskId) === currentTaskId}
                onSelect={handleSelectRun}
              />
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

const AutomationRunPopoverItem = observer(function AutomationRunPopoverItem({
  run,
  projectId,
  tool,
  isCurrent,
  onSelect,
}: {
  run: AutomationRun;
  projectId: string;
  tool: ReturnType<typeof automationTool>;
  isCurrent: boolean;
  onSelect: (run: AutomationRun) => void;
}) {
  const taskId = run.taskId ?? run.createdTaskId;
  const task = taskId ? getRegisteredTaskData(projectId, taskId) : undefined;
  const interactive = Boolean(taskId && task && !task.archivedAt) && !isCurrent;
  const isFailed = run.status === 'failed';
  const timestamp = run.startedAt ?? run.scheduledAt ?? run.finishedAt;

  return (
    <button
      type="button"
      disabled={!interactive}
      onClick={() => onSelect(run)}
      className={cn(
        'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors',
        interactive ? 'hover:bg-muted/40' : 'cursor-default opacity-60',
        isCurrent && 'bg-muted/30'
      )}
    >
      <span className="text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-sm border border-border/70 bg-background">
        {tool ? (
          <AgentLogo
            logo={tool.logo}
            alt={tool.label}
            isSvg={tool.isSvg}
            invertInDark={tool.invertInDark}
            className="size-3 rounded-[2px]"
          />
        ) : (
          <Bot className="size-3" />
        )}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate font-medium',
          isFailed ? 'text-destructive' : 'text-foreground'
        )}
      >
        {formatRunName(run.id)}
        {isCurrent ? <span className="text-muted-foreground ml-1.5">(current)</span> : null}
      </span>
      {timestamp != null ? (
        <AbsoluteTime value={timestamp} className="text-muted-foreground shrink-0" />
      ) : null}
    </button>
  );
});

const AutomationTitlebarRightSlot = observer(function AutomationTitlebarRightSlot({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const projectStore = asMounted(getProjectStore(projectId));
  const workspace = useWorkspace();
  const taskView = useWorkspaceViewModel();
  const isRemoteProject = projectStore?.data.type === 'ssh';

  return (
    <div className="flex items-center gap-2">
      <DevServerPills projectId={projectId} taskId={taskId} />
      {!isRemoteProject && (
        <OpenInMenu path={workspace.path} className="h-7 bg-background" borderless />
      )}
      <Separator orientation="vertical" className="h-5 self-center!" />
      <Tooltip>
        <TooltipTrigger>
          <Toggle
            size="sm"
            pressed={taskView.isTerminalDrawerOpen}
            className="border-none"
            onPressedChange={() => taskView.setTerminalDrawerOpen(!taskView.isTerminalDrawerOpen)}
          >
            <Terminal className="size-3.5" />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>
          Toggle terminal <BoundShortcut settingsKey="toggleTerminalDrawer" variant="badge" />
        </TooltipContent>
      </Tooltip>
      <Separator orientation="vertical" className="h-5 self-center!" />
      <ToggleGroup
        value={taskView.isSidebarCollapsed ? [] : [taskView.sidebarTab]}
        onValueChange={([tab]) => {
          if (!tab) {
            taskView.setSidebarCollapsed(true);
          } else {
            taskView.setSidebarTab(tab as SidebarTab);
            taskView.setSidebarCollapsed(false);
          }
        }}
        size="icon-sm"
        className="border-none"
      >
        <Tooltip>
          <TooltipTrigger>
            <ToggleGroupItem size="icon-sm" value="changes" aria-label="Changes">
              <FileDiff className="size-3.5" />
            </ToggleGroupItem>
          </TooltipTrigger>
          <TooltipContent>Changes</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger>
            <ToggleGroupItem size="icon-sm" value="conversations" aria-label="Conversations">
              <MessageSquare className="size-3.5" />
            </ToggleGroupItem>
          </TooltipTrigger>
          <TooltipContent>Conversations</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger>
            <ToggleGroupItem size="icon-sm" value="files" aria-label="Files">
              <FolderOpen className="size-3.5" />
            </ToggleGroupItem>
          </TooltipTrigger>
          <TooltipContent>Files</TooltipContent>
        </Tooltip>
      </ToggleGroup>
    </div>
  );
});
