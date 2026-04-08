import { Archive, Loader2, Pencil, Trash2 } from 'lucide-react';
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
  getTaskManagerStore,
  getTaskStore,
  taskAgentStatus,
} from '@renderer/core/stores/task-selectors';
import { LifecycleStatusIndicator } from '@renderer/core/tasks/components/lifecycleStatusIndicator';
import { useNavigate, useParams, useWorkspaceSlots } from '@renderer/core/view/navigation-provider';
import { cn } from '@renderer/lib/utils';
import { SidebarItemMiniButton, SidebarMenuRow } from './sidebar-primitives';

interface SidebarTaskItemProps {
  taskId: string;
  projectId: string;
}

export const SidebarTaskItem = observer(function SidebarTaskItem({
  taskId,
  projectId,
}: SidebarTaskItemProps) {
  const { navigate } = useNavigate();
  const showRename = useShowModal('renameTaskModal');
  const showConfirm = useShowModal('confirmActionModal');

  const { currentView } = useWorkspaceSlots();
  const { params } = useParams('task');
  const isActive =
    currentView === 'task' && params.taskId === taskId && params.projectId === projectId;

  const task = getTaskStore(projectId, taskId);
  const taskManager = getTaskManagerStore(projectId);

  if (!task) return null;

  const isBootstrapping =
    task.state === 'unregistered' ||
    (task.state === 'unprovisioned' &&
      (task.phase === 'provision' || task.phase === 'provision-error'));

  const taskName = task.data.name;
  const lifecycleStatus = task.data.status;
  const status = taskAgentStatus(task);
  const showStatus = sidebarStore.showSidebarTaskStatus;

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

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <SidebarMenuRow
          className={cn('group/row flex items-center px-1 h-8 gap-1 pl-6', !showStatus && 'pl-8')}
          isActive={isActive}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            handleProvision();
            navigate('task', { projectId, taskId });
          }}
        >
          {showStatus && (
            <div
              className="h-6 w-6 flex items-center justify-center"
              onClick={(e) => e.stopPropagation()}
            >
              <LifecycleStatusIndicator
                lifecycleStatus={lifecycleStatus}
                onLifecycleStatusChange={(next) => {
                  task.provisionedTask?.updateStatus(next);
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
          {isBootstrapping ? (
            <SidebarItemMiniButton type="button" disabled aria-label="Loading">
              <Loader2 className="h-4 w-4 animate-spin text-foreground/60" />
            </SidebarItemMiniButton>
          ) : showStatus ? (
            <AgentStatusIndicator status={status} />
          ) : null}
        </SidebarMenuRow>
      </ContextMenuTrigger>
      <ContextMenuContent>
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
