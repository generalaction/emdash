import { useVirtualizer } from '@tanstack/react-virtual';
import { Archive, RotateCcw, Trash2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useRef } from 'react';
import { getProjectViewStore } from '@core/features/projects/browser/stores/project-selectors';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { deleteSelectedTasks } from '@core/features/tasks/browser/delete-selected-tasks';
import { getTaskManagerStore } from '@core/features/tasks/browser/stores/task-selectors';
import { taskListScope } from '@core/features/tasks/contributions/scopes';
import { disabled, enabled, type ViewScopeImpl } from '@core/primitives/view-scopes/api';
import { useViewScope, ViewScopeInstanceProvider } from '@core/primitives/view-scopes/react';
import { ListPopoverCard } from '@renderer/lib/components/list-popover-card';
import { useCurrentViewParams } from '@renderer/lib/layout/navigation-provider';
import { useOpenModal } from '@renderer/lib/modal/api';
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
          Delete <BoundShortcut command="task.deleteSelected" variant="keycaps" />
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
  } = useCurrentViewParams(projectViewDef);
  const taskManager = getTaskManagerStore(projectId);
  const projectView = getProjectViewStore(projectId);
  const openCreateTaskModal = useOpenModal('taskModal');

  const taskView = projectView?.taskView ?? null;
  const implementation = {
    'task.deleteSelected': () => ({
      availability: () =>
        taskView && taskView.selectedIds.size > 0 ? enabled : disabled('Select one or more tasks'),
      execute: () => {
        void deleteSelectedTasks(projectId);
      },
    }),
  } satisfies ViewScopeImpl<typeof taskListScope>;
  const { attachRef, instance } = useViewScope(taskListScope({ projectId }), implementation);

  const allTasks = taskManager
    ? Array.from(taskManager.tasks.values()).filter(
        (t): t is ReadyTask => t.state !== 'unregistered' && t.data.type !== 'automation-run'
      )
    : [];
  const activeTasks = allTasks.filter((t) => !t.data.archivedAt);
  const archivedTasks = allTasks.filter((t) => Boolean(t.data.archivedAt));

  const clearSelection = () => taskView?.setSelectedIds(new Set());

  const bulkArchive = () => {
    if (!taskView) return;

    const ids = [...taskView.selectedIds];
    ids.forEach((id) => void taskManager?.archiveTask(id));
    clearSelection();
  };

  const bulkRestore = () => {
    if (!taskView) return;

    const ids = [...taskView.selectedIds];
    ids.forEach((id) => void taskManager?.restoreTask(id));
    clearSelection();
  };

  const bulkDelete = () => {
    void deleteSelectedTasks(projectId);
  };

  if (!taskView) return null;

  const displayTasks = taskView.tab === 'active' ? activeTasks : archivedTasks;
  const q = taskView.searchQuery.trim().toLowerCase();
  const filteredTasks = q
    ? displayTasks.filter((t) => t.data.name.toLowerCase().includes(q))
    : displayTasks;

  return (
    <ViewScopeInstanceProvider instance={instance}>
      <div
        ref={attachRef}
        tabIndex={-1}
        className="relative flex h-full min-h-0 w-full flex-col outline-none"
        onPointerDownCapture={(event) => event.currentTarget.focus({ preventScroll: true })}
      >
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
              <Button onClick={() => void openCreateTaskModal({ projectId })}>
                Create Task <BoundShortcut command="app.newTask" variant="keycaps" />
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
    </ViewScopeInstanceProvider>
  );
});
