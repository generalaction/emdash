import {
  ArrowDown,
  ArrowUp,
  Bot,
  ChevronDown,
  FileDiff,
  FolderOpen,
  GitBranch,
  MessageSquare,
  Pin,
  RefreshCcw,
  Terminal,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { formatRunName } from '@shared/automations/format';
import type { Automation, AutomationRun } from '@shared/automations/types';
import type { Issue } from '@shared/tasks';
import { automationTool } from '@renderer/features/automations/automation-tools';
import { useAutomationRuns, useAutomations } from '@renderer/features/automations/useAutomations';
import {
  asMounted,
  getProjectStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';
import {
  getRegisteredTaskData,
  getTaskStore,
  taskDisplayName,
  taskViewKind,
} from '@renderer/features/tasks/stores/task-selectors';
import {
  useTaskViewContext,
  useWorkspace,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { ConnectionStatusDot } from '@renderer/lib/components/connection-status-dot';
import { OpenInMenu } from '@renderer/lib/components/titlebar/open-in-menu';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { MicroLabel } from '@renderer/lib/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { Separator } from '@renderer/lib/ui/separator';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { Spinner } from '@renderer/lib/ui/spinner';
import { Toggle } from '@renderer/lib/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { DevServerPills } from './components/dev-server-pills';
import { IssueSelector, ProviderLogo } from './components/issue-selector/issue-selector';
import { type SidebarTab } from './types';
import { useGitActions } from './use-git-actions';

export const TaskTitlebar = observer(function TaskTitlebar() {
  const { projectId, taskId } = useTaskViewContext();
  const taskStore = getTaskStore(projectId, taskId);
  const kind = taskViewKind(taskStore, projectId);
  const automationId = taskStore?.data.automationId;

  if (automationId) {
    return (
      <AutomationTaskTitlebar
        projectId={projectId}
        taskId={taskId}
        automationId={automationId}
        ready={kind === 'ready'}
      />
    );
  }

  if (kind !== 'ready') {
    return <PendingTaskTitlebar taskId={taskId} projectId={projectId} />;
  }

  return <ActiveTaskTitlebar taskId={taskId} projectId={projectId} />;
});

const AutomationTaskTitlebar = observer(function AutomationTaskTitlebar({
  projectId,
  taskId,
  automationId,
  ready,
}: {
  projectId: string;
  taskId: string;
  automationId: string;
  ready: boolean;
}) {
  const { automations } = useAutomations();
  const automation = automations.data?.find((entry) => entry.id === automationId);
  const automationName = automation?.name ?? 'Automation';
  const projectName = projectDisplayName(getProjectStore(projectId));

  return (
    <Titlebar
      leftSlot={
        <div className="flex items-center gap-1 px-2 text-sm text-foreground-muted">
          <span className="text-sm text-foreground-passive">{projectName}</span>
          <span className="text-sm text-foreground-passive">/</span>
          <AutomationRunsPopover
            automationId={automationId}
            automationName={automationName}
            automation={automation}
            projectId={projectId}
            currentTaskId={taskId}
          />
        </div>
      }
      rightSlot={
        ready ? (
          <AutomationTaskTitlebarRightSlot projectId={projectId} taskId={taskId} />
        ) : undefined
      }
    />
  );
});

function AutomationRunsPopover({
  automationId,
  automationName,
  automation,
  projectId,
  currentTaskId,
}: {
  automationId: string;
  automationName: string;
  automation: Automation | undefined;
  projectId: string;
  currentTaskId: string;
}) {
  const [open, setOpen] = useState(false);
  const { navigate } = useNavigate();
  const runs = useAutomationRuns(automationId, 25);
  const tool = automationTool(automation);

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
        <span className="truncate max-w-64">{automationName}</span>
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
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">No runs yet.</div>
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
      <span className="flex size-5 shrink-0 items-center justify-center rounded-sm border border-border/70 bg-background text-muted-foreground">
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
        {isCurrent ? <span className="ml-1.5 text-muted-foreground">(current)</span> : null}
      </span>
      {timestamp != null ? (
        <RelativeTime value={timestamp} compact ago className="shrink-0 text-muted-foreground" />
      ) : null}
    </button>
  );
});

const AutomationTaskTitlebarRightSlot = observer(function AutomationTaskTitlebarRightSlot({
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
          Toggle terminal <ShortcutHint settingsKey="toggleTerminalDrawer" />
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

const PendingTaskTitlebar = observer(function PendingTaskTitlebar({
  taskId,
  projectId,
}: {
  taskId: string;
  projectId: string;
}) {
  const taskStore = getTaskStore(projectId, taskId)!;
  const projectName = projectDisplayName(getProjectStore(projectId));
  const name = taskDisplayName(taskStore);

  return (
    <Titlebar
      leftSlot={
        <div className="flex items-center gap-1 px-2 text-sm text-foreground-muted">
          <span className="flex items-center gap-1">
            <span className="text-sm text-foreground-passive">{projectName}</span>
            <span className="text-sm text-foreground-passive">/</span>
            {name}
          </span>
        </div>
      }
    />
  );
});

const ActiveTaskTitlebar = observer(function ActiveTaskTitlebar({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const taskStore = getTaskStore(projectId, taskId)!;
  const taskPayload = getRegisteredTaskData(projectId, taskId)!;
  const workspace = useWorkspace();
  const taskView = useWorkspaceViewModel();

  const {
    hasUpstream,
    aheadCount,
    behindCount,
    fetch,
    pull,
    push,
    publish,
    isPublishing,
    isFetching,
    isPulling,
    isPushing,
  } = useGitActions(projectId, taskId);

  const projectStore = asMounted(getProjectStore(projectId));

  const projectName = projectDisplayName(getProjectStore(projectId));

  const isRemoteProject = projectStore?.data.type === 'ssh';
  return (
    <Titlebar
      leftSlot={
        <div className="flex items-center gap-1 px-2">
          <Popover>
            <PopoverTrigger className="flex items-center gap-1 text-sm text-foreground-muted hover:text-foreground">
              <span className="flex items-center gap-1">
                <span className="text-sm text-foreground-passive">{projectName}</span>
                <span className="text-sm text-foreground-passive">/</span>
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="truncate max-w-56">{taskDisplayName(taskStore)}</span>
                  <ConnectionStatusDot state={workspace.connectionState} />
                </span>
              </span>
              <ChevronDown className="size-3.5 shrink-0" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-96 p-4 flex flex-col gap-2">
              <div className="flex flex-col gap-1 w-full">
                <MicroLabel className="text-foreground-passive items-center flex">Task</MicroLabel>
                <span className="text-sm tracking-tight">{taskDisplayName(taskStore)}</span>
              </div>
              <div className="flex flex-col gap-1 border border-border rounded-md p-2">
                <span className="flex items-center gap-1 text-foreground-muted">
                  <GitBranch className="size-3.5" />
                  <span>{workspace.git.branchName}</span>
                </span>
                {taskPayload.sourceBranch && (
                  <span className="flex items-center gap-2 text-foreground-passive">
                    Created from
                    <span className="flex items-center gap-1 text-foreground-muted">
                      <GitBranch className="size-3.5" /> {taskPayload.sourceBranch.branch}
                    </span>
                  </span>
                )}
                <div className="flex items-center gap-1 w-full">
                  {hasUpstream ? (
                    <>
                      <Tooltip>
                        <TooltipTrigger className="flex-1">
                          <Button
                            className="w-full"
                            variant="outline"
                            size="xs"
                            disabled={isFetching}
                            onClick={() => fetch()}
                          >
                            <RefreshCcw className="size-3" />
                            {isFetching ? 'Fetching...' : 'Fetch'}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {isFetching ? 'Fetching...' : 'Fetch changes'}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger className="flex-1">
                          <Button
                            className="w-full"
                            variant="outline"
                            disabled={isPulling || behindCount === 0}
                            size="xs"
                            onClick={() => pull()}
                          >
                            <ArrowDown className="size-3" />
                            {isPulling ? (
                              'Pulling...'
                            ) : (
                              <span className="flex items-center gap-1">
                                Pull
                                <Badge variant="secondary" className="shrink-0">
                                  {behindCount}
                                </Badge>
                              </span>
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {isPulling
                            ? 'Pulling...'
                            : behindCount === 0
                              ? 'Nothing to pull'
                              : 'Pull changes'}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger className="flex-1">
                          <Button
                            className="w-full"
                            variant="outline"
                            disabled={isPushing || aheadCount === 0}
                            size="xs"
                            onClick={() => push()}
                          >
                            <ArrowUp className="size-3" />
                            {isPushing ? (
                              'Pushing...'
                            ) : (
                              <span className="flex items-center gap-1">
                                Push
                                <Badge variant="secondary" className="shrink-0">
                                  {aheadCount}
                                </Badge>
                              </span>
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {isPushing
                            ? 'Pushing...'
                            : aheadCount === 0
                              ? 'Nothing to push'
                              : 'Push changes'}
                        </TooltipContent>
                      </Tooltip>
                    </>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger className="flex-1">
                        <Button
                          className="w-full"
                          variant="outline"
                          disabled={isPublishing}
                          size="xs"
                          onClick={() => publish()}
                        >
                          <ArrowUp className="size-3" />
                          {isPublishing ? 'Publishing...' : 'Publish'}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {isPublishing ? 'Publishing...' : 'Publish branch'}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>
              <IssueSelector
                value={taskPayload.linkedIssue ?? null}
                onValueChange={(issue) => {
                  void taskStore.updateLinkedIssue(issue ?? undefined);
                }}
                projectId={projectId}
                repositoryUrl={workspace.repository.repositoryUrl ?? ''}
                projectPath={workspace.path}
                excludeTaskId={taskId}
              />
            </PopoverContent>
          </Popover>
          {taskPayload.linkedIssue ? <LinkedIssueBadge issue={taskPayload.linkedIssue} /> : null}
          <button
            className={cn(
              'text-foreground-muted ml-1',
              taskPayload.isPinned && 'text-muted-foreground'
            )}
            onClick={() => taskStore.setPinned(!taskPayload.isPinned)}
          >
            <Pin
              className={cn('size-3.5', taskPayload.isPinned && 'text-foreground-muted')}
              fill={taskPayload.isPinned ? 'currentColor' : 'none'}
            />
          </button>
        </div>
      }
      rightSlot={
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
                onPressedChange={() =>
                  taskView.setTerminalDrawerOpen(!taskView.isTerminalDrawerOpen)
                }
              >
                <Terminal className="size-3.5" />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent>
              Toggle terminal <ShortcutHint settingsKey="toggleTerminalDrawer" />
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
      }
    />
  );
});

function LinkedIssueBadge({ issue }: { issue: Issue }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            disabled={!issue.url}
            onClick={() => {
              if (issue.url) void rpc.app.openExternal(issue.url);
            }}
            className="flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-foreground-muted hover:bg-muted/30 disabled:cursor-default disabled:opacity-60"
          >
            <ProviderLogo provider={issue.provider} className="h-3 w-3" />
            <span className="font-mono">{issue.identifier}</span>
          </button>
        }
      />
      <TooltipContent>{issue.title || issue.identifier}</TooltipContent>
    </Tooltip>
  );
}
