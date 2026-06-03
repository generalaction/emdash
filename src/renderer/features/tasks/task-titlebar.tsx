import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Clock,
  FileDiff,
  FolderOpen,
  GitBranch,
  Pin,
  RefreshCcw,
  Terminal,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { AutomationTaskTitlebar } from '@renderer/features/automations/components/AutomationTaskTitlebar';
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
import { ConnectionStatusDot } from '@renderer/lib/components/connection-status-dot';
import { OpenInMenu } from '@renderer/lib/components/titlebar/open-in-menu';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { MicroLabel } from '@renderer/lib/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { Separator } from '@renderer/lib/ui/separator';
import { BoundShortcut } from '@renderer/lib/ui/shortcut';
import { Toggle } from '@renderer/lib/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { formatDiffLineCount } from '@renderer/utils/format-diff-line-count';
import { cn } from '@renderer/utils/utils';
import type { Issue } from '@shared/tasks';
import { DevServerPills } from './components/dev-server-pills';
import { IssueSelector, ProviderLogo } from './components/issue-selector/issue-selector';
import { type SidebarTab } from './types';
import { useGitActions } from './use-git-actions';

export const TaskTitlebar = observer(function TaskTitlebar() {
  const { projectId, taskId } = useTaskViewContext();
  const taskStore = getTaskStore(projectId, taskId);
  const kind = taskViewKind(taskStore, projectId);

  if (taskStore?.data.automationId) {
    return <AutomationTaskTitlebar />;
  }

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
  const taskStore = getTaskStore(projectId, taskId);
  const projectName = projectDisplayName(getProjectStore(projectId));
  const name = taskDisplayName(taskStore);
  const { navigate } = useNavigate();

  return (
    <Titlebar
      leftSlot={
        <div className="flex items-center gap-1 px-2 text-sm text-foreground-muted">
          <span className="flex items-center gap-1">
            <button
              type="button"
              className="text-sm text-foreground-passive hover:text-foreground"
              onClick={() => navigate('project', { projectId })}
            >
              {projectName}
            </button>
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
  const taskStore = getTaskStore(projectId, taskId);
  const taskPayload = getRegisteredTaskData(projectId, taskId);
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

  const linesAdded = workspace.git.totalLinesAdded;
  const linesDeleted = workspace.git.totalLinesDeleted;
  const hasDiffStats = linesAdded > 0 || linesDeleted > 0;

  const projectStore = asMounted(getProjectStore(projectId));

  const projectName = projectDisplayName(getProjectStore(projectId));
  const { navigate } = useNavigate();

  if (!taskStore || !taskPayload) return null;

  const isRemoteProject = projectStore?.data.type === 'ssh';
  return (
    <Titlebar
      leftSlot={
        <div className="flex items-center gap-1 px-2">
          <button
            type="button"
            className="text-sm text-foreground-passive hover:text-foreground"
            onClick={() => navigate('project', { projectId })}
          >
            {projectName}
          </button>
          <span className="text-sm text-foreground-passive">/</span>
          <Popover>
            <Tooltip>
              <TooltipTrigger
                render={
                  <PopoverTrigger className="flex items-center gap-1 text-sm text-foreground-muted hover:text-foreground">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="max-w-56 truncate">{taskDisplayName(taskStore)}</span>
                      <ConnectionStatusDot state={workspace.connectionState} />
                    </span>
                    <ChevronDown className="size-3.5 shrink-0" />
                  </PopoverTrigger>
                }
              />
              <TooltipContent>Link to issue</TooltipContent>
            </Tooltip>
            <PopoverContent align="start" className="flex w-96 flex-col gap-2 p-4">
              <div className="flex w-full flex-col gap-1">
                <MicroLabel className="flex items-center text-foreground-passive">Task</MicroLabel>
                <span className="text-sm tracking-tight">{taskDisplayName(taskStore)}</span>
              </div>
              <div className="flex flex-col gap-1 rounded-md border border-border p-2">
                <span className="flex items-center gap-1 text-foreground-muted">
                  <GitBranch className="size-3.5" />
                  <span>{workspace.git.branchName}</span>
                </span>
                <div className="flex w-full items-center gap-1">
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
                repositoryUrl={workspace.repository.issueRepositoryUrl ?? ''}
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
          <OpenInMenu
            path={workspace.path}
            className="h-7 bg-transparent"
            borderless
            isRemote={isRemoteProject}
            sshConnectionId={workspace.sshConnectionId}
          />
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
            className="border-none bg-transparent"
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <ToggleGroupItem
                    value="changes"
                    aria-label="Changes"
                    className={cn('w-auto! min-w-7! gap-0', hasDiffStats && 'w-full px-2!')}
                  >
                    <FileDiff className="size-3.5" />
                    <span
                      className={cn(
                        'overflow-hidden transition-[max-width,padding-left] duration-500 ease-in-out flex items-center tabular-nums text-xs leading-none gap-1',
                        hasDiffStats ? 'max-w-20 pl-1' : 'max-w-0 pl-0'
                      )}
                    >
                      {linesAdded > 0 && (
                        <span className="text-foreground-diff-added">
                          +{formatDiffLineCount(linesAdded)}
                        </span>
                      )}
                      {linesDeleted > 0 && (
                        <span className="text-foreground-diff-deleted">
                          -{formatDiffLineCount(linesDeleted)}
                        </span>
                      )}
                    </span>
                  </ToggleGroupItem>
                }
              />
              <TooltipContent>
                Changes <BoundShortcut settingsKey="sidebarChanges" variant="badge" />
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <ToggleGroupItem size="icon-sm" value="files" aria-label="Files">
                    <FolderOpen className="size-3.5" />
                  </ToggleGroupItem>
                }
              />
              <TooltipContent>
                Files <BoundShortcut settingsKey="sidebarFiles" variant="badge" />
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <ToggleGroupItem size="icon-sm" value="conversations" aria-label="Conversations">
                    <Clock className="size-3.5" />
                  </ToggleGroupItem>
                }
              />
              <TooltipContent>
                Conversations <BoundShortcut settingsKey="sidebarConversations" variant="badge" />
              </TooltipContent>
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
            className="hover:bg-muted/30 flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-foreground-muted disabled:cursor-default disabled:opacity-60"
          >
            <ProviderLogo provider={issue.provider} className="h-3 w-3" />
            {issue.provider === 'asana' ? (
              <span className="max-w-[180px] truncate">{issue.title || 'Asana task'}</span>
            ) : (
              <span className="font-mono">{issue.identifier}</span>
            )}
          </button>
        }
      />
      <TooltipContent>{issue.title || issue.identifier}</TooltipContent>
    </Tooltip>
  );
}
