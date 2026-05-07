import {
  ArrowDown,
  ArrowUp,
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
import type { Issue } from '@shared/tasks';
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
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { ConnectionStatusDot } from '@renderer/lib/components/connection-status-dot';
import { OpenInMenu } from '@renderer/lib/components/titlebar/open-in-menu';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { rpc } from '@renderer/lib/ipc';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { MicroLabel } from '@renderer/lib/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { Separator } from '@renderer/lib/ui/separator';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
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

  if (kind !== 'ready') {
    return <PendingTaskTitlebar taskId={taskId} projectId={projectId} />;
  }

  return <ActiveTaskTitlebar taskId={taskId} projectId={projectId} />;
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
  const provisionedTask = useProvisionedTask();
  const { taskView } = provisionedTask;

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
                  <ConnectionStatusDot state={provisionedTask.workspace.connectionState} />
                </span>
              </span>
              <ChevronDown className="size-3.5 shrink-0" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-96 p-4 flex flex-col gap-2">
              <div className="flex flex-col gap-1 w-full">
                <MicroLabel className="text-foreground-passive items-center flex">Task</MicroLabel>
                <span className="text-sm tracking-tight">{taskDisplayName(taskStore)}</span>
              </div>
              <OpenInMenu path={provisionedTask.path} />
              <div className="flex flex-col gap-1 border border-border rounded-md p-2">
                <span className="flex items-center gap-1 text-foreground-muted">
                  <GitBranch className="size-3.5" />
                  <span>{provisionedTask.workspace.git.branchName}</span>
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
                repositoryUrl={provisionedTask.repositoryStore.repositoryUrl ?? ''}
                projectPath={provisionedTask.path}
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
            <OpenInMenu path={provisionedTask.path} className="h-7 bg-background" borderless />
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
