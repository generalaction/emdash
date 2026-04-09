import { useVirtualizer } from '@tanstack/react-virtual';
import { Archive, RotateCcw, Trash2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useRef } from 'react';
import { StatusIcon } from '@renderer/components/projects/pr-row';
import { Button } from '@renderer/components/ui/button';
import { EmptyState } from '@renderer/components/ui/empty-state';
import { SearchInput } from '@renderer/components/ui/search-input';
import { Separator } from '@renderer/components/ui/separator';
import ShortcutHint from '@renderer/components/ui/shortcut-hint';
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { asMounted, getProjectStore } from '@renderer/core/stores/project-selectors';
import { getTaskManagerStore } from '@renderer/core/stores/task-selectors';
import { useParams } from '@renderer/core/view/navigation-provider';
import { cn } from '@renderer/lib/utils';
import { ReadyTask, TaskRow } from './task-row';

function TaskVirtualList({
  tasks,
  selectedIds,
  onToggleSelect,
}: {
  tasks: ReadyTask[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line react-hooks/incompatible-library
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
      className="overflow-y-auto min-h-0 flex-1 py-3"
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
                onToggleSelect={() => onToggleSelect(task.data.id)}
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
  const store = asMounted(getProjectStore(projectId));
  const taskManager = getTaskManagerStore(projectId);
  const showConfirm = useShowModal('confirmActionModal');
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
    <div className="flex flex-col max-w-3xl mx-auto w-full pt-6 px-6 min-h-0">
      <div className="flex flex-col gap-4 border-b border-border pb-2 shrink-0">
        <div className="flex items-center gap-2 flex-wrap justify-between">
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
              Create Task <ShortcutHint settingsKey="newTask" />
            </Button>
          </div>
        </div>
      </div>

      <TaskVirtualList
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
