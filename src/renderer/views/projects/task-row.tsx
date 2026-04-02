import { Archive, MoreHorizontal, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { type Task } from '@shared/tasks';
import { Button } from '@renderer/components/ui/button';
import { Checkbox } from '@renderer/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import RelativeTime from '@renderer/components/ui/relative-time';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { type TaskStore } from '@renderer/core/stores/task';
import { getTaskManagerStore } from '@renderer/core/stores/task-selectors';
import { useNavigate } from '@renderer/core/view/navigation-provider';

export type ReadyTask = TaskStore & { data: Task };

export const TaskRow = observer(function TaskRow({
  task,
  isSelected,
  onToggleSelect,
}: {
  task: ReadyTask;
  isSelected: boolean;
  onToggleSelect: () => void;
}) {
  const { navigate } = useNavigate();
  const showRename = useShowModal('renameTaskModal');
  const showConfirm = useShowModal('confirmActionModal');
  const taskManager = getTaskManagerStore(task.data.projectId);

  const handleArchive = () => void taskManager?.archiveTask(task.data.id);
  const handleRestore = () => void taskManager?.restoreTask(task.data.id);
  const handleProvision = () => void taskManager?.provisionTask(task.data.id);
  const handleDelete = () =>
    showConfirm({
      title: 'Delete task',
      description: `"${task.data.name}" will be permanently deleted. This action cannot be undone.`,
      confirmLabel: 'Delete',
      onSuccess: () => void taskManager?.deleteTask(task.data.id),
    });
  const handleRename = () =>
    showRename({
      projectId: task.data.projectId,
      taskId: task.data.id,
      currentName: task.data.name,
    });

  const isArchived = Boolean(task.data.archivedAt);

  return (
    <button
      onClick={() => {
        handleProvision();
        navigate('task', { projectId: task.data.projectId, taskId: task.data.id });
      }}
      className="group flex items-center gap-3 rounded-lg p-3 py-4 hover:bg-background-1 transition-colors w-full"
    >
      <div onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={isSelected} onCheckedChange={onToggleSelect} aria-label="Select task" />
      </div>
      <span className="flex-1 min-w-0 text-left text-sm truncate">{task.data.name}</span>
      <RelativeTime
        value={task.data.createdAt}
        className="shrink-0 text-xs text-foreground-passive"
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => e.stopPropagation()}
              className="opacity-0 group-hover:opacity-100 shrink-0"
              aria-label="Task actions"
            />
          }
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!isArchived && (
            <>
              <DropdownMenuItem onClick={handleRename}>
                <Pencil className="size-4" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleArchive}>
                <Archive className="size-4" />
                Archive
              </DropdownMenuItem>
            </>
          )}
          {isArchived && (
            <DropdownMenuItem onClick={handleRestore}>
              <RotateCcw className="size-4" />
              Restore
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" onClick={handleDelete}>
            <Trash2 className="size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </button>
  );
});
