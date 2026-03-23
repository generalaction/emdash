import { Archive, MoreHorizontal, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import type { ComponentProps } from 'react';
import type { Task } from '@shared/tasks';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { useTaskLifecycleContext } from '@renderer/core/tasks/task-lifecycle-provider';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

interface TaskActionsMenuProps {
  task: Task;
  onArchived?: () => void;
  onDeleted?: () => void;
  showRestore?: boolean;
  triggerProps?: Partial<ComponentProps<typeof Button>>;
  align?: 'start' | 'center' | 'end';
}

export function TaskActionsMenu({
  task,
  onArchived,
  onDeleted,
  showRestore,
  triggerProps,
  align = 'end',
}: TaskActionsMenuProps) {
  const { archiveTask, restoreTask, deleteTask } = useTaskLifecycleContext();
  const showConfirm = useShowModal('confirmActionModal');
  const showRename = useShowModal('renameTaskModal');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" {...triggerProps}>
            <MoreHorizontal className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align={align}>
        {!showRestore && (
          <DropdownMenuItem
            onClick={() =>
              showRename({
                projectId: task.projectId,
                taskId: task.id,
                currentName: task.name,
              })
            }
          >
            <Pencil className="size-4" />
            Rename
          </DropdownMenuItem>
        )}
        {showRestore ? (
          <DropdownMenuItem
            onClick={() => {
              restoreTask(task.id);
            }}
          >
            <RotateCcw className="size-4" />
            Restore
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onClick={() => {
              archiveTask(task.projectId, task.id);
              onArchived?.();
            }}
          >
            <Archive className="size-4" />
            Archive
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          variant="destructive"
          onClick={() =>
            showConfirm({
              title: 'Delete task',
              description: `"${task.name}" will be permanently deleted. This action cannot be undone.`,
              confirmLabel: 'Delete',
              onSuccess: () => {
                deleteTask(task.id);
                onDeleted?.();
              },
            })
          }
        >
          <Trash2 className="size-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
