import { Archive, MoreHorizontal, Pencil, RotateCcw, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Task } from '@shared/tasks';
import { Button } from '@renderer/components/ui/button';
import { Checkbox } from '@renderer/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import { Input } from '@renderer/components/ui/input';
import { Spinner } from '@renderer/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs';
import { useTask, useTaskLifecycleContext } from '@renderer/core/tasks/task-lifecycle-provider';
import { useTasksDataContext } from '@renderer/core/tasks/tasks-data-provider';
import { useNavigate } from '@renderer/core/view/navigation-provider';
import { useRequiredCurrentProject } from '@renderer/views/projects/project-view-wrapper';

function TaskRow({
  task,
  isSelected,
  onToggleSelect,
}: {
  task: Task;
  isSelected: boolean;
  onToggleSelect: () => void;
}) {
  const { navigate } = useNavigate();
  const { archiveTask, restoreTask, provisionTask } = useTaskLifecycleContext();
  const lifecycleTask = useTask({ projectId: task.projectId, taskId: task.id });

  const handleArchive = () => archiveTask(task.projectId, task.id);
  const handleRestore = () => restoreTask(task.id);

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
      {lifecycleTask.status !== 'ready' && (
        <Spinner size="sm" className="size-3 shrink-0 text-muted-foreground" />
      )}
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
          <DropdownMenuItem onClick={handleArchive}>
            <Archive className="size-4" />
            Archive
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleRestore}>
            <RotateCcw className="size-4" />
            Restore
          </DropdownMenuItem>

          <DropdownMenuItem>
            <Pencil className="size-4" />
            Rename
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
}: {
  tasks: Task[];
  selectedIds: Set<string>;
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
          onToggleSelect={() => onToggleSelect(task.id)}
        />
      ))}
    </div>
  );
}

export function TaskList() {
  const project = useRequiredCurrentProject();
  const { activeTasksByProjectId, archivedTasksByProjectId } = useTasksDataContext();
  const { archiveTask, restoreTask } = useTaskLifecycleContext();

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

  const handleTabChange = (value: string) => {
    setActiveTab(value as 'active' | 'archived');
    clearSelection();
  };

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
          <TaskRows tasks={filteredTasks} selectedIds={selectedIds} onToggleSelect={toggleSelect} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
