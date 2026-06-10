import { useHotkey } from '@tanstack/react-hotkeys';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Archive, CheckIcon, RotateCcw, Trash2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { AnimatePresence, motion } from 'motion/react';
import { useRef } from 'react';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { getTaskManagerStore } from '@renderer/features/tasks/stores/task-selectors';
import { FilterMenuButton } from '@renderer/lib/components/filter-menu-button';
import { ListPopoverCard } from '@renderer/lib/components/list-popover-card';
import { SortSelect } from '@renderer/lib/components/sort-select';
import {
  getEffectiveHotkey,
  getHotkeyRegistration,
} from '@renderer/lib/hooks/useKeyboardShortcuts';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { modalStore } from '@renderer/lib/modal/modal-store';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { SearchInput } from '@renderer/lib/ui/search-input';
import { BoundShortcut } from '@renderer/lib/ui/shortcut';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { cn } from '@renderer/utils/utils';
import {
  AGENT_FILTER_OPTIONS,
  CHANGES_FILTER_OPTIONS,
  PR_FILTER_OPTIONS,
  TASK_SORT_OPTIONS,
  sortTasks,
  taskMatchesFilters,
  type TaskFilters,
} from './task-filters';
import { TaskListEmptyState } from './task-list-empty-state';
import { TaskRow, type ReadyTask } from './task-row';

function FilterMenu<T extends string>({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  selected: ReadonlySet<T>;
  onToggle: (value: T) => void;
}) {
  const active = selected.size > 0;
  return (
    <FilterMenuButton
      label={label}
      active={active}
      badge={
        active ? (
          <span className="text-xs text-foreground-muted">({selected.size})</span>
        ) : undefined
      }
      contentClassName="w-48 p-1"
    >
      <ul className="max-h-60 overflow-y-auto">
        {options.map((option) => (
          <li key={option.value}>
            <button
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-background-1"
              onClick={() => onToggle(option.value)}
            >
              <span className="flex-1 truncate text-left">{option.label}</span>
              {selected.has(option.value) && (
                <CheckIcon className="size-3.5 shrink-0 text-foreground" />
              )}
            </button>
          </li>
        ))}
      </ul>
    </FilterMenuButton>
  );
}

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
          Delete <BoundShortcut settingsKey="deleteSelectedTasks" />
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
  const { value: keyboard } = useAppSettingsKey('keyboard');

  const taskView = store?.view.taskView ?? null;

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
    if (!taskView) return;
    if (taskView.selectedIds.size === 0) return;

    const selectedTasks = [...taskView.selectedIds]
      .map((id) => taskManager?.tasks.get(id))
      .filter((t): t is ReadyTask => !!t)
      .map((t) => ({ taskId: t.data.id, taskName: t.data.name }));

    if (selectedTasks.length === 0) return;

    showDeleteTask({
      projectId,
      tasks: selectedTasks,
      onSuccess: ({ deleteWorktree, deleteBranch }) => {
        void taskManager?.deleteTasks([...taskView.selectedIds], { deleteWorktree, deleteBranch });
        clearSelection();
      },
    });
  };

  useHotkey(
    getHotkeyRegistration('deleteSelectedTasks', keyboard),
    (e) => {
      e.preventDefault();
      bulkDelete();
    },
    {
      enabled:
        (taskView?.selectedIds.size ?? 0) > 0 &&
        !modalStore.isOpen &&
        getEffectiveHotkey('deleteSelectedTasks', keyboard) !== null,
      ignoreInputs: true,
    }
  );

  if (!taskView) return null;

  const displayTasks = taskView.tab === 'active' ? activeTasks : archivedTasks;
  const q = taskView.searchQuery.trim().toLowerCase();
  const filters: TaskFilters = {
    agent: taskView.agentFilter,
    pr: taskView.prFilter,
    changes: taskView.changesFilter,
  };
  const filteredTasks = sortTasks(
    displayTasks.filter(
      (t) => (!q || t.data.name.toLowerCase().includes(q)) && taskMatchesFilters(t, filters)
    ),
    taskView.sortBy
  );
  const hasSearchOrFilters = Boolean(q) || taskView.hasActiveFilters;
  const showOnboardingEmptyState =
    filteredTasks.length === 0 && taskView.tab === 'active' && !hasSearchOrFilters;
  const showFilteredEmptyState = filteredTasks.length === 0 && hasSearchOrFilters;

  const clearSearchAndFilters = () => {
    taskView.setSearchQuery('');
    taskView.clearFilters();
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SortSelect
            value={taskView.sortBy}
            options={TASK_SORT_OPTIONS}
            onValueChange={(value) => taskView.setSortBy(value)}
          />
          <div className="flex flex-wrap items-center">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-foreground-passive">Filter by</span>
              <FilterMenu
                label="Agent"
                options={AGENT_FILTER_OPTIONS}
                selected={taskView.agentFilter}
                onToggle={(value) => taskView.toggleAgentFilter(value)}
              />
              <FilterMenu
                label="PR"
                options={PR_FILTER_OPTIONS}
                selected={taskView.prFilter}
                onToggle={(value) => taskView.togglePrFilter(value)}
              />
              <FilterMenu
                label="Changes"
                options={CHANGES_FILTER_OPTIONS}
                selected={taskView.changesFilter}
                onToggle={(value) => taskView.toggleChangesFilter(value)}
              />
            </div>
            <AnimatePresence initial={false}>
              {taskView.hasActiveFilters && (
                <motion.button
                  key="clear-filters"
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.1, ease: 'easeOut' }}
                  className="shrink-0 overflow-hidden pl-3 text-xs whitespace-nowrap text-foreground-muted hover:text-foreground"
                  onClick={() => taskView.clearFilters()}
                >
                  Clear
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {showOnboardingEmptyState ? (
        <TaskListEmptyState projectId={projectId} />
      ) : showFilteredEmptyState ? (
        <EmptyState
          label="No matching tasks"
          description="Adjust your search or filters to see more tasks."
          action={
            <Button variant="outline" size="sm" onClick={clearSearchAndFilters}>
              Clear search and filters
            </Button>
          }
        />
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
