import { Archive, Loader2, Pencil, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@renderer/components/ui/context-menu';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { TaskStore } from '@renderer/core/stores/task';
import { getTaskManagerStore } from '@renderer/core/stores/task-selectors';
import { useNavigate } from '@renderer/core/view/navigation-provider';
import { cn } from '@renderer/lib/utils';
import { SidebarItemMiniButton, SidebarMenuRow } from './sidebar-primitives';

interface SidebarTaskItemProps {
  task: TaskStore;
  projectId: string;
  isActive: boolean;
}

export const SidebarTaskItem = observer(function SidebarTaskItem({
  task,
  projectId,
  isActive,
}: SidebarTaskItemProps) {
  const { navigate } = useNavigate();
  const showRename = useShowModal('renameTaskModal');
  const showConfirm = useShowModal('confirmActionModal');

  const isBootstrapping =
    task.state === 'unregistered' ||
    (task.state === 'unprovisioned' &&
      (task.phase === 'provision' || task.phase === 'provision-error'));

  const taskId = task.data.id;
  const taskName = task.data.name;
  const taskManager = getTaskManagerStore(projectId);

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
          className={cn('group/row flex items-center p-1.5 pl-9')}
          isActive={isActive}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            handleProvision();
            navigate('task', { projectId, taskId });
          }}
        >
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
          ) : (
            <SidebarItemMiniButton
              type="button"
              className="opacity-0 group-hover/row:opacity-100 transition-opacity duration-150"
              onClick={(e) => {
                e.stopPropagation();
                handleArchive();
              }}
              aria-label="Archive task"
            >
              <Archive className="h-4 w-4" />
            </SidebarItemMiniButton>
          )}
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
