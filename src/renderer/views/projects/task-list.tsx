import { Archive, MoreHorizontal, Pencil, RotateCcw, Search, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
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
import { useShowModal } from '@renderer/core/modal/modal-provider';
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
    <div className="group flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-muted/50">
      <Checkbox checked={isSelected} onCheckedChange={onToggleSelect} aria-label="Select task" />
      <button
        type="button"
        className="flex-1 min-w-0 text-left text-sm truncate hover:underline"
        onClick={() => {
          handleProvision();
          navigate('task', { projectId: task.data.projectId, taskId: task.data.id });
        }}
        onPointerEnter={handleProvision}
      >
        {task.data.name}
      </button>
      {isTransitioning && <Spinner size="sm" className="size-3 shrink-0 text-muted-foreground" />}
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
    </div>
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
    return <p className="py-8 text-center text-sm text-muted-foreground">No tasks</p>;
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

export const TaskList = observer(function TaskList() {
  const {
    params: { projectId },
  } = useParams('project');
  const taskManager = getTaskManagerStore(projectId);
  const showRename = useShowModal('renameTaskModal');
  const showConfirm = useShowModal('confirmActionModal');

  // Computed inline so MobX tracks task.data.archivedAt directly in the observer render
  const allTasks = taskManager
    ? Array.from(taskManager.tasks.values()).filter(
        (t): t is ReadyTask => t.state !== 'unregistered'
      )
    : [];
  const activeTasks = allTasks.filter((t) => !t.data.archivedAt);
  const archivedTasks = allTasks.filter((t) => Boolean(t.data.archivedAt));

  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const displayTasks = activeTab === 'active' ? activeTasks : archivedTasks;
  const q = searchQuery.trim().toLowerCase();
  const filteredTasks = q
    ? displayTasks.filter((t) => t.data.name.toLowerCase().includes(q))
    : displayTasks;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(filteredTasks.map((t) => t.data.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const allSelected =
    filteredTasks.length > 0 && filteredTasks.every((t) => selectedIds.has(t.data.id));
  const someSelected = selectedIds.size > 0 && !allSelected;
  const singleSelectedTask =
    selectedIds.size === 1 ? filteredTasks.find((t) => selectedIds.has(t.data.id)) : undefined;

  const handleTabChange = (value: string) => {
    setActiveTab(value as 'active' | 'archived');
    clearSelection();
  };

  const bulkArchive = () => {
    const ids = [...selectedIds];
    ids.forEach((id) => void taskManager?.archiveTask(id));
    clearSelection();
  };

  const bulkRestore = () => {
    const ids = [...selectedIds];
    ids.forEach((id) => void taskManager?.restoreTask(id));
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
        ids.forEach((id) => void taskManager?.deleteTask(id));
        clearSelection();
      },
    });
  };

  return (
    <div className="flex flex-col gap-4 pt-4">
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
                      onClick={() =>
                        showRename({
                          projectId: singleSelectedTask.data.projectId,
                          taskId: singleSelectedTask.data.id,
                          currentName: singleSelectedTask.data.name,
                        })
                      }
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
          <TaskRows tasks={filteredTasks} selectedIds={selectedIds} onToggleSelect={toggleSelect} />
        </TabsContent>
      </Tabs>
    </div>
  );
});
