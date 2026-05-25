import { useVirtualizer } from '@tanstack/react-virtual';
import { Archive, RotateCcw, Trash2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useRef } from 'react';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { getTaskManagerStore } from '@renderer/features/tasks/stores/task-selectors';
import { ListPopoverCard } from '@renderer/lib/components/list-popover-card';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { SearchInput } from '@renderer/lib/ui/search-input';
import { BoundShortcut } from '@renderer/lib/ui/shortcut';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { cn } from '@renderer/utils/utils';
import { TaskListEmptyState } from './task-list-empty-state';
import { TaskRow, type ReadyTask } from './task-row';

function TaskVirtualList({
  tasks,
  selectedIds,
  onToggleSelect,
}: {
  tasks: ReadyTask[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string, shiftKey: boolean) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 5,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  const virtualItems = virtualizer.getVirtualItems();

  if (tasks.length === 0) {
    return <EmptyState label="No tasks" description="No tasks found" />;
  }

  return (
    <div
      ref={parentRef}
      className="min-h-0 flex-1 overflow-y-auto py-3"
      style={{ scrollbarWidth: 'none' }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualItems.map((virtualItem) => {
          const task = tasks[virtualItem.index]!;
          return (
            <div
              key={virtualItem.key}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              className={cn(virtualItem.index === tasks.length - 1 && 'border-b-0')}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <TaskRow
                task={task}
                isSelected={selectedIds.has(task.data.id)}
                onToggleSelect={(shiftKey) => onToggleSelect(task.data.id, shiftKey)}
              />
            </div>
          );
        })}
      </div>
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
    <ListPopoverCard className="justify-between">
      <span className="whitespace-nowrap text-foreground-muted">{count} selected</span>
      <div className="flex items-center gap-2">
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
        <Button variant="ghost" size="icon-xs" onClick={onClear} aria-label="Clear selection">
          <X className="size-3.5" />
        </Button>
      </div>
    </ListPopoverCard>
  );
}

export const TaskList = observer(function TaskList() {
  const {
    params: { projectId },
  } = useParams('project');
  const store = asMounted(getProjectStore(projectId));
  const taskManager = getTaskManagerStore(projectId);
  const showDeleteTask = useShowModal('deleteTaskModal');
  const showCreateTaskModal = useShowModal('taskModal');

  const taskView = store?.view.taskView ?? null;

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
    const selectedTasks = [...taskView.selectedIds]
      .map((id) => taskManager?.tasks.get(id))
      .filter((t): t is ReadyTask => !!t)
      .map((t) => ({ taskId: t.data.id, taskName: t.data.name }));

    showDeleteTask({
      projectId,
      tasks: selectedTasks,
      onSuccess: ({ deleteWorktree, deleteBranch }) => {
        void taskManager?.deleteTasks([...taskView.selectedIds], { deleteWorktree, deleteBranch });
        clearSelection();
      },
    });
  };

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col">
      <div className="flex shrink-0 flex-col gap-4 border-b border-border pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
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
          <div className="flex items-center gap-2">
            <SearchInput
              placeholder="Search tasks…"
              value={taskView.searchQuery}
              onChange={(e) => taskView.setSearchQuery(e.target.value)}
              className="flex-1"
            />
            <Button onClick={() => showCreateTaskModal({ projectId })}>
              Create Task <BoundShortcut settingsKey="newTask" />
            </Button>
          </div>
        </div>
      </div>

      {filteredTasks.length === 0 && taskView.tab === 'active' ? (
        <TaskListEmptyState projectId={projectId} />
      ) : (
        <TaskVirtualList
          tasks={filteredTasks}
          selectedIds={taskView.selectedIds}
          onToggleSelect={(id, shiftKey) => {
            if (shiftKey) {
              taskView.selectRange(
                filteredTasks.map((t) => t.data.id),
                id
              );
            } else {
              taskView.toggleSelect(id);
            }
          }}
        />
      )}

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
