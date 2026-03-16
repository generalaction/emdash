import { Archive, MoreHorizontal, RotateCcw, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Task } from '@shared/tasks';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { useNavigate } from '@renderer/core/view/navigation-provider';
import { useTasksContext } from '@renderer/features/tasks/tasks-provider';
import { useRequiredCurrentProject } from '@renderer/views/projects/project-view-wrapper';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Input } from '../ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';

const STATUS_LABEL: Record<string, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  review: 'Review',
  done: 'Done',
  archived: 'Archived',
};

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  todo: 'outline',
  in_progress: 'default',
  review: 'secondary',
  done: 'outline',
  archived: 'outline',
};

function TaskRow({
  task,
  isSelected,
  onToggleSelect,
  onArchive,
  onRestore,
  onDelete,
}: {
  task: Task;
  isSelected: boolean;
  onToggleSelect: () => void;
  onArchive?: () => void;
  onRestore?: () => void;
  onDelete: () => void;
}) {
  const { navigate } = useNavigate();

  return (
    <div className="group flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-muted/50">
      <Checkbox checked={isSelected} onCheckedChange={onToggleSelect} aria-label="Select task" />
      <button
        type="button"
        className="flex-1 min-w-0 text-left text-sm truncate hover:underline"
        onClick={() => navigate('task', { projectId: task.projectId, taskId: task.id })}
      >
        {task.name}
      </button>
      <Badge variant={STATUS_VARIANT[task.status] ?? 'outline'} className="shrink-0">
        {STATUS_LABEL[task.status] ?? task.status}
      </Badge>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="opacity-0 group-hover:opacity-100 shrink-0"
              aria-label="Task actions"
            />
          }
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {onArchive && (
            <DropdownMenuItem onClick={onArchive}>
              <Archive className="size-4" />
              Archive
            </DropdownMenuItem>
          )}
          {onRestore && (
            <DropdownMenuItem onClick={onRestore}>
              <RotateCcw className="size-4" />
              Restore
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 className="size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function TaskRows({
  tasks,
  selectedIds,
  onToggleSelect,
  onArchive,
  onRestore,
  onDelete,
}: {
  tasks: Task[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onArchive?: (task: Task) => void;
  onRestore?: (task: Task) => void;
  onDelete: (task: Task) => void;
}) {
  if (tasks.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No tasks</p>;
  }

  return (
    <div className="flex flex-col">
      {tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          isSelected={selectedIds.has(task.id)}
          onToggleSelect={() => onToggleSelect(task.id)}
          onArchive={onArchive ? () => onArchive(task) : undefined}
          onRestore={onRestore ? () => onRestore(task) : undefined}
          onDelete={() => onDelete(task)}
        />
      ))}
    </div>
  );
}

export function TaskList() {
  const project = useRequiredCurrentProject();
  const { tasksByProjectId, activeTasksByProjectId, archiveTask, restoreTask, deleteTask } =
    useTasksContext();
  const showConfirm = useShowModal('confirmActionModal');

  const activeTasks = activeTasksByProjectId[project.id] ?? [];
  const archivedTasks = useMemo(() => {
    const all = tasksByProjectId[project.id] ?? [];
    return all.filter((t) => Boolean(t.archivedAt));
  }, [tasksByProjectId, project.id]);

  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const displayTasks = activeTab === 'active' ? activeTasks : archivedTasks;

  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return q ? displayTasks.filter((t) => t.name.toLowerCase().includes(q)) : displayTasks;
  }, [displayTasks, searchQuery]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(filteredTasks.map((t) => t.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const allSelected = filteredTasks.length > 0 && filteredTasks.every((t) => selectedIds.has(t.id));
  const someSelected = selectedIds.size > 0 && !allSelected;

  const handleTabChange = (value: string) => {
    setActiveTab(value as 'active' | 'archived');
    clearSelection();
  };

  // Single-task actions
  const handleArchive = (task: Task) => {
    archiveTask(task.projectId, task.id);
  };

  const handleRestore = (task: Task) => {
    restoreTask(task.id);
  };

  const handleDelete = (task: Task) => {
    showConfirm({
      title: 'Delete task',
      description: `"${task.name}" will be permanently deleted. This action cannot be undone.`,
      confirmLabel: 'Delete',
      onSuccess: () => deleteTask(task.id),
    });
  };

  // Bulk actions
  const bulkArchive = () => {
    const ids = [...selectedIds];
    Promise.all(
      ids.map((id) => {
        const task = activeTasks.find((t) => t.id === id);
        return task ? archiveTask(task.projectId, task.id) : Promise.resolve();
      })
    ).then(clearSelection);
  };

  const bulkRestore = () => {
    const ids = [...selectedIds];
    Promise.all(ids.map((id) => restoreTask(id))).then(clearSelection);
  };

  const bulkDelete = () => {
    const count = selectedIds.size;
    showConfirm({
      title: `Delete ${count} task${count === 1 ? '' : 's'}`,
      description: 'The selected tasks will be permanently deleted. This action cannot be undone.',
      confirmLabel: `Delete ${count} task${count === 1 ? '' : 's'}`,
      onSuccess: () => {
        const ids = [...selectedIds];
        Promise.all(ids.map((id) => deleteTask(id))).then(clearSelection);
      },
    });
  };

  return (
    <div className="flex flex-col gap-4 pt-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search tasks…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-8"
        />
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <TabsList variant="line">
            <TabsTrigger value="active">Active ({activeTasks.length})</TabsTrigger>
            <TabsTrigger value="archived">Archived ({archivedTasks.length})</TabsTrigger>
          </TabsList>
        </div>

        {/* Bulk toolbar */}
        {filteredTasks.length > 0 && (
          <div className="flex items-center gap-2 border-b border-border py-2">
            <Checkbox
              checked={allSelected}
              indeterminate={someSelected}
              onCheckedChange={(checked) => (checked ? selectAll() : clearSelection())}
              aria-label="Select all"
            />
            {selectedIds.size > 0 ? (
              <>
                <span className="text-sm text-muted-foreground">{selectedIds.size} selected</span>
                <div className="ml-auto flex items-center gap-1.5">
                  {activeTab === 'active' && (
                    <Button variant="outline" size="sm" onClick={bulkArchive}>
                      <Archive className="size-3.5" />
                      Archive
                    </Button>
                  )}
                  {activeTab === 'archived' && (
                    <Button variant="outline" size="sm" onClick={bulkRestore}>
                      <RotateCcw className="size-3.5" />
                      Restore
                    </Button>
                  )}
                  <Button variant="destructive" size="sm" onClick={bulkDelete}>
                    <Trash2 className="size-3.5" />
                    Delete
                  </Button>
                </div>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">
                {filteredTasks.length} task{filteredTasks.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
        )}

        <TabsContent value="active">
          <TaskRows
            tasks={filteredTasks}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onArchive={handleArchive}
            onDelete={handleDelete}
          />
        </TabsContent>
        <TabsContent value="archived">
          <TaskRows
            tasks={filteredTasks}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onRestore={handleRestore}
            onDelete={handleDelete}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
