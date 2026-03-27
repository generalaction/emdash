import { Archive, MoreHorizontal, Pencil, RotateCcw, Trash2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Button } from '@renderer/components/ui/button';
import { Checkbox } from '@renderer/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import { EmptyState } from '@renderer/components/ui/empty-state';
import { SearchInput } from '@renderer/components/ui/search-input';
import { Separator } from '@renderer/components/ui/separator';
import { Spinner } from '@renderer/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { isMountedProject } from '@renderer/core/stores/project';
import { getProjectStore } from '@renderer/core/stores/project-selectors';
import { ProvisionedTask, UnprovisionedTask } from '@renderer/core/stores/task';
import { getTaskManagerStore } from '@renderer/core/stores/task-selectors';
import { useNavigate, useParams } from '@renderer/core/view/navigation-provider';

type ReadyTask = UnprovisionedTask | ProvisionedTask;

const TaskRow = observer(function TaskRow({
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

  const isTransitioning =
    task.state === 'unprovisioned' &&
    task.phase !== 'idle' &&
    task.phase !== 'provision-error' &&
    task.phase !== 'teardown-error';

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
      className="group flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-background-1"
    >
      <Checkbox
        onClick={(e) => e.stopPropagation()}
        checked={isSelected}
        onCheckedChange={onToggleSelect}
        aria-label="Select task"
      />
      <span className="flex-1 min-w-0 text-left text-sm truncate">{task.data.name}</span>
      {isTransitioning && <Spinner size="sm" className="size-3 shrink-0 text-muted-foreground" />}
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

function TaskRows({
  tasks,
  selectedIds,
  onToggleSelect,
}: {
  tasks: ReadyTask[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  if (tasks.length === 0) {
    return <EmptyState label="No tasks" description="No tasks found" />;
  }

  return (
    <div className="flex flex-col">
      {tasks.map((task) => (
        <TaskRow
          key={task.data.id}
          task={task}
          isSelected={selectedIds.has(task.data.id)}
          onToggleSelect={() => onToggleSelect(task.data.id)}
        />
      ))}
    </div>
  );
}

function SelectionBar({
  count,
  tab,
  onClear,
  onArchive,
  onRestore,
  onDelete,
}: {
  count: number;
  tab: 'active' | 'archived';
  onClear: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  if (count === 0) return null;

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl border border-border bg-popover px-3 py-2 shadow-lg">
      <span className="text-sm text-muted-foreground whitespace-nowrap">{count} selected</span>
      <Separator orientation="vertical" className="h-4" />
      <Button variant="ghost" size="icon-sm" onClick={onClear} aria-label="Clear selection">
        <X className="size-3.5" />
      </Button>
      {tab === 'active' && (
        <Button variant="outline" size="sm" onClick={onArchive}>
          <Archive className="size-3.5" />
          Archive
        </Button>
      )}
      {tab === 'archived' && (
        <Button variant="outline" size="sm" onClick={onRestore}>
          <RotateCcw className="size-3.5" />
          Restore
        </Button>
      )}
      <Button variant="destructive" size="sm" onClick={onDelete}>
        <Trash2 className="size-3.5" />
        Delete
      </Button>
    </div>
  );
}

export const TaskList = observer(function TaskList() {
  const {
    params: { projectId },
  } = useParams('project');
  const store = getProjectStore(projectId);
  const taskManager = getTaskManagerStore(projectId);
  const showConfirm = useShowModal('confirmActionModal');

  const taskView = store && isMountedProject(store) ? store.view.taskView : null;

  const allTasks = taskManager
    ? Array.from(taskManager.tasks.values()).filter(
        (t): t is ReadyTask => t.state !== 'unregistered'
      )
    : [];
  const activeTasks = allTasks.filter((t) => !t.data.archivedAt);
  const archivedTasks = allTasks.filter((t) => Boolean(t.data.archivedAt));

  if (!taskView) return null;

  const displayTasks = taskView.tab === 'active' ? activeTasks : archivedTasks;
  const q = taskView.searchQuery.trim().toLowerCase();
  const filteredTasks = q
    ? displayTasks.filter((t) => t.data.name.toLowerCase().includes(q))
    : displayTasks;

  const clearSelection = () => taskView.setSelectedIds(new Set());

  const bulkArchive = () => {
    const ids = [...taskView.selectedIds];
    ids.forEach((id) => void taskManager?.archiveTask(id));
    clearSelection();
  };

  const bulkRestore = () => {
    const ids = [...taskView.selectedIds];
    ids.forEach((id) => void taskManager?.restoreTask(id));
    clearSelection();
  };

  const bulkDelete = () => {
    const count = taskView.selectedIds.size;
    showConfirm({
      title: `Delete ${count} task${count === 1 ? '' : 's'}`,
      description: 'The selected tasks will be permanently deleted. This action cannot be undone.',
      confirmLabel: `Delete ${count} task${count === 1 ? '' : 's'}`,
      onSuccess: () => {
        const ids = [...taskView.selectedIds];
        ids.forEach((id) => void taskManager?.deleteTask(id));
        clearSelection();
      },
    });
  };

  return (
    <div className="flex flex-col gap-4 max-w-3xl mx-auto w-full pt-10 px-10">
      <div className="flex relative items-center gap-3 justify-between">
        <ToggleGroup
          multiple={false}
          value={[taskView.tab]}
          onValueChange={([value]) => {
            if (value) taskView.setTab(value as 'active' | 'archived');
          }}
        >
          <ToggleGroupItem value="active">Active ({activeTasks.length})</ToggleGroupItem>
          <ToggleGroupItem value="archived">Archived ({archivedTasks.length})</ToggleGroupItem>
        </ToggleGroup>
        <SearchInput
          placeholder="Search tasks…"
          value={taskView.searchQuery}
          onChange={(e) => taskView.setSearchQuery(e.target.value)}
          className="flex-1"
        />
      </div>

      <TaskRows
        tasks={filteredTasks}
        selectedIds={taskView.selectedIds}
        onToggleSelect={(id) => taskView.toggleSelect(id)}
      />

      <SelectionBar
        count={taskView.selectedIds.size}
        tab={taskView.tab}
        onClear={clearSelection}
        onArchive={bulkArchive}
        onRestore={bulkRestore}
        onDelete={bulkDelete}
      />
    </div>
  );
});
