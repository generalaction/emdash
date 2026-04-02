import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ExternalLink,
  FileDiff,
  Files,
  GitBranch,
  GitCommit,
  Globe,
  ListTree,
  MessageSquare,
  RefreshCcw,
  Terminal,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { IssueSelector } from '@renderer/components/issue-selector';
import { OpenInMenu } from '@renderer/components/titlebar/open-in-menu';
import { Titlebar } from '@renderer/components/titlebar/Titlebar';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { MicroLabel } from '@renderer/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover';
import { ShortcutHint } from '@renderer/components/ui/shortcut-hint';
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip';
import { rpc } from '@renderer/core/ipc';
import { getTaskStore, taskDisplayName, taskViewKind } from '@renderer/core/stores/task-selectors';
import { RightPanelView } from '@renderer/core/tasks/types';
import { useDelayedBoolean } from '@renderer/hooks/use-delay-boolean';
import { useTaskViewNavigation } from './hooks/use-task-view-navigation';
import { useTaskViewShortcuts } from './hooks/use-task-view-shortcuts';
import {
  useProvisionedTask,
  useRequireProvisionedTask,
  useTaskViewContext,
} from './task-view-context';
import { useGitActions } from './use-git-actions';

function formatUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return url;
  }
}

const DevServerPills = observer(function DevServerPills({
  projectId: _projectId,
  taskId: _taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const urls = useProvisionedTask()?.devServers?.urls ?? [];

  if (urls.length === 0) return null;

  return (
    <>
      {urls.map((url) => (
        <Tooltip key={url}>
          <TooltipTrigger>
            <button
              type="button"
              onClick={() => rpc.app.openExternal(url)}
              className="flex h-7 rounded-md items-center gap-1.5 border border-green-300 bg-green-50 px-2 py-1 text-xs text-foreground-muted transition-colors hover:border-green-400 hover:text-foreground"
            >
              <Globe className="size-3 shrink-0 text-green-700" />
              <span className="text-green-700">{formatUrl(url)}</span>
              <ExternalLink className="size-3 shrink-0 text-green-700" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Dev server running at {url}
          </TooltipContent>
        </Tooltip>
      ))}
    </>
  );
});

export const TaskTitlebar = observer(function TaskTitlebar() {
  const { projectId, taskId } = useTaskViewContext();
  const taskStore = getTaskStore(projectId, taskId);
  const kind = taskViewKind(taskStore, projectId);

  if (kind !== 'ready') {
    return <PendingTaskTitlebar name={taskDisplayName(taskStore)} />;
  }

  return <ActiveTaskTitlebar taskId={taskId} projectId={projectId} />;
});

function PendingTaskTitlebar({ name }: { name?: string }) {
  return (
    <Titlebar
      leftSlot={
        <div className="flex items-center gap-1 px-2">
          <span className="text-sm text-muted-foreground">{name}</span>
        </div>
      }
    />
  );
}

const ActiveTaskTitlebar = observer(function ActiveTaskTitlebar({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const taskStore = getTaskStore(projectId, taskId);
  const taskState = useRequireProvisionedTask();
  const { view, rightPanelView } = taskState;
  const { openAgentsView, openEditorView, openDiffView, isPending } = useTaskViewNavigation();
  const delayedIsPending = useDelayedBoolean(isPending, 200);
  useTaskViewShortcuts();

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

  return (
    <Titlebar
      leftSlot={
        <div className="flex items-center gap-1 px-2">
          <Popover>
            <PopoverTrigger className="flex items-center gap-1 text-sm text-foreground-muted hover:text-foreground">
              {taskDisplayName(taskStore)}
              <ChevronDown className="size-3.5 shrink-0" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-96 p-4 flex flex-col gap-2">
              <div className="flex flex-col gap-1 w-full">
                <MicroLabel className="text-foreground-passive items-center flex">Task</MicroLabel>
                <span className="text-sm tracking-tight">{taskDisplayName(taskStore)}</span>
              </div>
              <OpenInMenu path={taskState.path} />
              <div className="flex flex-col gap-1 border border-border rounded-md p-2">
                <span className="flex items-center gap-1 text-foreground-muted">
                  <GitBranch className="size-3.5" />
                  <span>{taskState.workspace.git.branchStatus.data?.branch}</span>
                </span>
                <span className="flex items-center gap-2 text-foreground-passive">
                  Created from
                  <span className="flex items-center gap-1 text-foreground-muted">
                    <GitBranch className="size-3.5" /> {taskState.data.sourceBranch}
                  </span>
                </span>
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
                value={taskState.data.linkedIssue ?? null}
                onValueChange={(issue) => {
                  taskState.updateLinkedIssue(issue ?? undefined);
                }}
                nameWithOwner={''}
              />
            </PopoverContent>
          </Popover>
        </div>
      }
      rightSlot={
        <div className="flex items-center gap-2 mr-2">
          <DevServerPills projectId={projectId} taskId={taskId} />
          <OpenInMenu path={taskState.path} className="h-7  bg-background" />
          <ToggleGroup
            disabled={delayedIsPending}
            variant="outline"
            value={[view]}
            size="sm"
            onValueChange={([value]) => {
              if (value === 'agents') openAgentsView();
              if (value === 'editor') openEditorView();
              if (value === 'diff') openDiffView();
            }}
          >
            <Tooltip>
              <TooltipTrigger>
                <ToggleGroupItem value="agents" size="sm">
                  <MessageSquare className="size-3.5" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>
                <div className="flex flex-col gap-1">
                  <span>Conversations view</span>
                  <ShortcutHint settingsKey="taskViewAgents" />
                </div>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger>
                <ToggleGroupItem value="diff" size="sm">
                  <FileDiff className="size-3.5" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>
                <div className="flex flex-col gap-1">
                  <span>Diff view</span>
                  <ShortcutHint settingsKey="taskViewDiff" />
                </div>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger>
                <ToggleGroupItem value="editor" size="sm">
                  <Files className="size-3.5" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>
                <div className="flex flex-col gap-1">
                  <span>File view</span>
                  <ShortcutHint settingsKey="taskViewEditor" />
                </div>
              </TooltipContent>
            </Tooltip>
          </ToggleGroup>
          <ToggleGroup
            disabled={delayedIsPending}
            variant="outline"
            value={[rightPanelView]}
            size="sm"
            onValueChange={([value]) => {
              if (!value) return;
              taskState.setRightPanelView(value as RightPanelView);
            }}
          >
            <Tooltip>
              <TooltipTrigger>
                <ToggleGroupItem value="changes" size="sm">
                  <GitCommit className="size-3.5" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>Git changes</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger>
                <ToggleGroupItem value="terminals" size="sm">
                  <Terminal className="size-3.5" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>Terminals</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger>
                <ToggleGroupItem value="files" size="sm">
                  <ListTree className="size-3.5" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>File explorer</TooltipContent>
            </Tooltip>
          </ToggleGroup>
        </div>
      }
    />
  );
});
