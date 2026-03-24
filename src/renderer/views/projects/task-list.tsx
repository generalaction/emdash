import { Archive, Pencil, RotateCcw, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Task } from '@shared/tasks';
import { TaskActionsMenu } from '@renderer/components/task-actions-menu';
import { Button } from '@renderer/components/ui/button';
import { Checkbox } from '@renderer/components/ui/checkbox';
import { Input } from '@renderer/components/ui/input';
import { Spinner } from '@renderer/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { useTask, useTaskLifecycleContext } from '@renderer/core/tasks/task-lifecycle-provider';
import { useTasksDataContext } from '@renderer/core/tasks/tasks-data-provider';
import { useNavigate } from '@renderer/core/view/navigation-provider';
import { useRequiredCurrentProject } from '@renderer/views/projects/project-view-wrapper';

function TaskRow({
  task,
  isSelected,
  showRestore,
  onToggleSelect,
}: {
  task: Task;
  isSelected: boolean;
  showRestore?: boolean;
  onToggleSelect: () => void;
}) {
  const { navigate } = useNavigate();
  const { provisionTask } = useTaskLifecycleContext();
  const lifecycleTask = useTask({ projectId: task.projectId, taskId: task.id });
  const isTearingDown = lifecycleTask.status === 'teardown';

  const handleProvision = () => provisionTask(task.id);

  return (
    <div className="group flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-muted/50">
      <Checkbox checked={isSelected} onCheckedChange={onToggleSelect} aria-label="Select task" />
      <button
        type="button"
        className="flex-1 min-w-0 text-left text-sm truncate hover:underline"
        onClick={() => {
          handleProvision();
          navigate('task', { projectId: task.projectId, taskId: task.id });
        }}
        onPointerEnter={handleProvision}
      >
        {task.name}
      </button>
      {isTearingDown ? (
        <span className="size-3 shrink-0 rounded-full bg-muted-foreground/50 animate-pulse" />
      ) : !showRestore && lifecycleTask.status !== 'ready' ? (
        <Spinner size="sm" className="size-3 shrink-0 text-muted-foreground" />
      ) : null}
      <TaskActionsMenu
        task={task}
        showRestore={showRestore}
        triggerProps={{
          className: 'opacity-0 group-hover:opacity-100 shrink-0',
          'aria-label': 'Task actions',
        }}
      />
    </div>
  );
}

function TaskRows({
  tasks,
  selectedIds,
  showRestore,
  onToggleSelect,
}: {
  tasks: Task[];
  selectedIds: Set<string>;
  showRestore?: boolean;
  onToggleSelect: (id: string) => void;
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
          showRestore={showRestore}
          onToggleSelect={() => onToggleSelect(task.id)}
        />
      ))}
    </div>
  );
}

export function TaskList() {
  const project = useRequiredCurrentProject();
  const { tasksByProjectId, activeTasksByProjectId, archivedTasksByProjectId } =
    useTasksDataContext();
  const { archiveTask, restoreTask, deleteTask } = useTaskLifecycleContext();
  const showConfirm = useShowModal('confirmActionModal');
  const showRename = useShowModal('renameTaskModal');

  const activeTasks = activeTasksByProjectId[project.id] ?? [];
  const archivedTasks = archivedTasksByProjectId[project.id] ?? [];

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
  const singleSelectedTask =
    selectedIds.size === 1
      ? (tasksByProjectId[project.id] ?? []).find((t) => selectedIds.has(t.id))
      : undefined;

  const handleTabChange = (value: string) => {
    setActiveTab(value as 'active' | 'archived');
    clearSelection();
  };

  const handleRename = (task: Task) => {
    showRename({
      projectId: task.projectId,
      taskId: task.id,
      currentName: task.name,
    });
  };

  // Bulk actions
  const bulkArchive = () => {
    const ids = [...selectedIds];
    ids.forEach((id) => archiveTask(project.id, id));
    clearSelection();
  };

  const bulkRestore = () => {
    const ids = [...selectedIds];
    ids.forEach((id) => restoreTask(id));
    clearSelection();
  };

  const bulkDelete = () => {
    const count = selectedIds.size;
    showConfirm({
      title: `Delete ${count} task${count === 1 ? '' : 's'}`,
      description: 'The selected tasks will be permanently deleted. This action cannot be undone.',
      confirmLabel: `Delete ${count} task${count === 1 ? '' : 's'}`,
      onSuccess: () => {
        const ids = [...selectedIds];
        ids.forEach((id) => deleteTask(project.id, id));
        clearSelection();
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
                  {singleSelectedTask && activeTab === 'active' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRename(singleSelectedTask)}
                    >
                      <Pencil className="size-3.5" />
                      Rename
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
          <TaskRows tasks={filteredTasks} selectedIds={selectedIds} onToggleSelect={toggleSelect} />
        </TabsContent>
        <TabsContent value="archived">
          <TaskRows
            tasks={filteredTasks}
            selectedIds={selectedIds}
            showRestore
            onToggleSelect={toggleSelect}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
