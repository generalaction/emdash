import { Archive, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { AgentStatusIndicator } from '@renderer/components/agent-status-indicator';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@renderer/components/ui/context-menu';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { sidebarStore } from '@renderer/core/stores/app-state';
import {
  getTaskGitStore,
  getTaskManagerStore,
  getTaskStore,
  taskAgentStatus,
} from '@renderer/core/stores/task-selectors';
import { CLISpinner } from '@renderer/core/tasks/components/cliSpinner';
import { LifecycleStatusIndicator } from '@renderer/core/tasks/components/lifecycleStatusIndicator';
import { useNavigate, useParams, useWorkspaceSlots } from '@renderer/core/view/navigation-provider';
import { useDelayedBoolean } from '@renderer/hooks/use-delay-boolean';
import { cn } from '@renderer/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { SidebarMenuRow } from './sidebar-primitives';

interface SidebarTaskItemProps {
  taskId: string;
  projectId: string;
  /** Pinned strip uses tighter padding than tasks nested under a project. */
  rowVariant?: 'underProject' | 'pinned';
}

export const SidebarTaskItem = observer(function SidebarTaskItem({
  taskId,
  projectId,
  rowVariant = 'underProject',
}: SidebarTaskItemProps) {
  const { navigate } = useNavigate();
  const showRename = useShowModal('renameTaskModal');
  const showConfirm = useShowModal('confirmActionModal');

  const { currentView } = useWorkspaceSlots();
  const { params } = useParams('task');
  const isActive =
    currentView === 'task' && params.taskId === taskId && params.projectId === projectId;

  const task = getTaskStore(projectId, taskId)!;
  const taskManager = getTaskManagerStore(projectId);
  const git = getTaskGitStore(projectId, taskId);

  const isBootstrapping =
    task.state === 'unregistered' ||
    (task.state === 'unprovisioned' &&
      (task.phase === 'provision' || task.phase === 'provision-error'));

  const delayedIsBootstrapping = useDelayedBoolean(isBootstrapping, 500);

  const taskName = task.data.name;
  const lifecycleStatus = task.data.status;
  const status = taskAgentStatus(task);
  const showStatus = sidebarStore.showSidebarTaskStatus;

  const linesAdded = git?.totalLinesAdded ?? 0;
  const linesDeleted = git?.totalLinesDeleted ?? 0;
  const showLineDiffStats =
    git !== undefined && !git.isLoading && !git.error && (linesAdded > 0 || linesDeleted > 0);

  const handleProvision = () => {
    if (task.state !== 'unprovisioned' || task.phase !== 'idle') return;
    taskManager?.provisionTask(taskId);
  };

  const handleArchive = () => void taskManager?.archiveTask(taskId);

  const handleRename = () => showRename({ projectId, taskId, currentName: taskName });

  const handleDelete = () =>
    showConfirm({
      title: 'Delete task',
      description: `"${taskName}" will be permanently deleted. This action cannot be undone.`,
      confirmLabel: 'Delete',
      onSuccess: () => {
        void taskManager?.deleteTask(taskId);
        if (isActive) navigate('project', { projectId });
      },
    });

  const canPin = task.state !== 'unregistered';

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <SidebarMenuRow
          className={cn(
            'group/row flex items-center justify-between px-1 h-8 gap-1',
            rowVariant === 'pinned'
              ? cn('pl-1', !showStatus && 'pl-2')
              : cn('pl-6', !showStatus && 'pl-8')
          )}
          isActive={isActive}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            handleProvision();
            navigate('task', { projectId, taskId });
          }}
        >
          <div className="flex items-center gap-1 min-w-0">
            {showStatus && (
              <div
                className="h-6 w-6 flex items-center justify-center"
                onClick={(e) => e.stopPropagation()}
              >
                <LifecycleStatusIndicator
                  lifecycleStatus={lifecycleStatus}
                  onLifecycleStatusChange={(next) => {
                    task.updateStatus(next);
                  }}
                />
              </div>
            )}
            <span
              className={cn(
                'flex-1 min-w-0 self-stretch flex items-center truncate text-left transition-colors',
                isBootstrapping && 'text-foreground/40'
              )}
            >
              {taskName}
            </span>
            {showLineDiffStats ? (
              <span
                className="shrink-0 tabular-nums text-[10px] h-full flex items-center leading-none text-muted-foreground pr-1 font-mono"
                aria-label={`${linesAdded} lines added, ${linesDeleted} lines removed`}
              >
                {linesAdded > 0 ? <span className="text-green-600">+{linesAdded}</span> : null}
                {linesAdded > 0 && linesDeleted > 0 ? ' ' : null}
                {linesDeleted > 0 ? <span className="text-red-600">-{linesDeleted}</span> : null}
              </span>
            ) : null}
          </div>
          {delayedIsBootstrapping ? (
            <Tooltip>
              <TooltipTrigger>
                <span className="size-6 flex justify-center items-center">
                  <CLISpinner variant="2" />
                </span>
              </TooltipTrigger>
              <TooltipContent>Creating task workspace...</TooltipContent>
            </Tooltip>
          ) : (
            <AgentStatusIndicator status={status} />
          )}
        </SidebarMenuRow>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {canPin ? (
          task.data.isPinned ? (
            <ContextMenuItem onClick={() => void task.setPinned(false)}>
              <PinOff className="size-4" />
              Unpin task
            </ContextMenuItem>
          ) : (
            <ContextMenuItem onClick={() => void task.setPinned(true)}>
              <Pin className="size-4" />
              Pin task
            </ContextMenuItem>
          )
        ) : null}
        <ContextMenuItem onClick={handleRename}>
          <Pencil className="size-4" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem onClick={handleArchive}>
          <Archive className="size-4" />
          Archive
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={handleDelete}>
          <Trash2 className="size-4" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});
