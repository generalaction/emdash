import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { ListTodo } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { AgentStatusIndicator } from '@renderer/features/tasks/components/agent-status-indicator';
import { TaskContextMenu } from '@renderer/features/tasks/components/task-context-menu';
import { TaskGitDiffStats } from '@renderer/features/tasks/components/task-git-diff-stats';
import {
  getTaskGitWorktreeStore,
  getTaskManagerStore,
  taskAgentStatus,
} from '@renderer/features/tasks/stores/task-selectors';
import { PrBadge } from '@renderer/lib/components/pr-badge';
import { StackedAgentLogos } from '@renderer/lib/components/stacked-agent-logos';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { cn } from '@renderer/utils/utils';
import { selectCurrentPr } from '@shared/core/pull-requests/pull-requests';
import {
  KANBAN_COLUMN_BY_ID,
  KANBAN_COLUMN_BY_STATUS,
  KANBAN_STATUS_COLUMNS,
  type KanbanColumn,
  type KanbanColumnMeta,
} from './kanban-task-model';
import type { ReadyTask } from './task-row';

const TASK_DND_PREFIX = 'task:';

function taskDndId(taskId: string): string {
  return `${TASK_DND_PREFIX}${taskId}`;
}

function parseTaskDndId(id: string): string | null {
  return id.startsWith(TASK_DND_PREFIX) ? id.slice(TASK_DND_PREFIX.length) : null;
}

function getKanbanColumnById(value: string): KanbanColumnMeta | undefined {
  return KANBAN_COLUMN_BY_ID[value];
}

function StatusMenu({ task }: { task: ReadyTask }) {
  const current = KANBAN_COLUMN_BY_STATUS[task.data.status];

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className="shrink-0"
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Change status from ${current.label}`}
            />
          }
        >
          <ListTodo className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuRadioGroup
            value={current.id}
            onValueChange={(value) => {
              const column = getKanbanColumnById(value);
              if (!column || column.id === current.id) return;
              void task.updateStatus(column.targetStatus);
            }}
          >
            {KANBAN_STATUS_COLUMNS.map((column) => (
              <DropdownMenuRadioItem key={column.id} value={column.id}>
                {column.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function KanbanTaskCardContent({
  task,
  isSelected,
  onToggleSelect,
}: {
  task: ReadyTask;
  isSelected: boolean;
  onToggleSelect: (shiftKey: boolean) => void;
}) {
  const showRename = useShowModal('renameTaskModal');
  const showDeleteTask = useShowModal('deleteTaskModal');
  const taskManager = getTaskManagerStore(task.data.projectId);
  const shiftKeyRef = useRef(false);

  const isArchived = Boolean(task.data.archivedAt);
  const agentAttention = taskAgentStatus(task);
  const currentPr = task.data.prs ? selectCurrentPr(task.data.prs) : undefined;
  const branchName =
    getTaskGitWorktreeStore(task.data.projectId, task.data.id)?.branchName ?? undefined;

  const handleArchive = () => void taskManager?.archiveTask(task.data.id);
  const handleRestore = () => void taskManager?.restoreTask(task.data.id);
  const handleDelete = () =>
    showDeleteTask({
      projectId: task.data.projectId,
      tasks: [{ taskId: task.data.id, taskName: task.data.name }],
      onSuccess: ({ deleteWorktree, deleteBranch }) =>
        void taskManager?.deleteTasks([task.data.id], { deleteWorktree, deleteBranch }),
    });
  const handleRename = () =>
    showRename({
      projectId: task.data.projectId,
      taskId: task.data.id,
      currentName: task.data.name,
    });

  return (
    <TaskContextMenu
      isPinned={task.data.isPinned}
      canPin
      isArchived={isArchived}
      branchName={branchName}
      onPin={() => void task.setPinned(true)}
      onUnpin={() => void task.setPinned(false)}
      onRename={handleRename}
      onArchive={handleArchive}
      onRestore={handleRestore}
      onConvertAutomation={undefined}
      onDelete={handleDelete}
    >
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <div
            onPointerDownCapture={(e) => {
              e.stopPropagation();
              shiftKeyRef.current = e.shiftKey;
            }}
            onKeyDownCapture={(e) => {
              shiftKeyRef.current = e.shiftKey;
            }}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'pt-0.5 transition-opacity',
              isSelected ? 'opacity-100' : 'opacity-0 group-hover/card:opacity-100'
            )}
          >
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => {
                const shift = shiftKeyRef.current;
                shiftKeyRef.current = false;
                onToggleSelect(shift);
              }}
              aria-label="Select task"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-left text-sm leading-snug text-foreground">
              {task.data.name}
            </p>
          </div>
          <StatusMenu task={task} />
        </div>
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <TaskGitDiffStats task={task} className="text-xs" />
            {currentPr && <PrBadge pr={currentPr} />}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <StackedAgentLogos stats={task.conversationStats} />
            {agentAttention ? (
              <AgentStatusIndicator status={agentAttention} disableTooltip />
            ) : (
              <RelativeTime
                value={task.data.updatedAt}
                className="font-mono text-xs text-foreground-passive"
                compact
              />
            )}
          </div>
        </div>
      </div>
    </TaskContextMenu>
  );
}

function KanbanTaskCard({
  task,
  isSelected,
  onToggleSelect,
}: {
  task: ReadyTask;
  isSelected: boolean;
  onToggleSelect: (shiftKey: boolean) => void;
}) {
  const { navigate } = useNavigate();
  const taskManager = getTaskManagerStore(task.data.projectId);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: taskDndId(task.data.id),
  });

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
  };

  const openTask = () => {
    if (task.data.archivedAt) return;
    void taskManager?.provisionTask(task.data.id);
    navigate('task', { projectId: task.data.projectId, taskId: task.data.id });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openTask();
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={task.data.archivedAt ? -1 : 0}
      onClick={openTask}
      onKeyDown={handleKeyDown}
      className={cn(
        'group/card cursor-pointer rounded-lg border border-border bg-background p-3 text-left shadow-sm transition-colors hover:bg-background-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        task.data.archivedAt && 'cursor-default opacity-80',
        isDragging && 'opacity-40'
      )}
    >
      <KanbanTaskCardContent task={task} isSelected={isSelected} onToggleSelect={onToggleSelect} />
    </article>
  );
}

function KanbanTaskOverlay({ task }: { task: ReadyTask }) {
  return (
    <div className="w-[18rem] rounded-lg border border-border bg-background p-3 text-left shadow-xl">
      <p className="line-clamp-2 text-sm leading-snug text-foreground">{task.data.name}</p>
    </div>
  );
}

function KanbanColumnView({
  column,
  selectedIds,
  onToggleSelect,
}: {
  column: KanbanColumn<ReadyTask>;
  selectedIds: Set<string>;
  onToggleSelect: (id: string, shiftKey: boolean) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <section
      ref={setNodeRef}
      className={cn(
        'flex h-full min-h-0 w-[18rem] shrink-0 flex-col rounded-lg border border-border bg-background-1 transition-colors',
        isOver && 'border-ring bg-background-2'
      )}
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <h3 className="truncate text-sm font-medium text-foreground">{column.label}</h3>
        <Badge variant="secondary">{column.tasks.length}</Badge>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {column.tasks.length === 0 ? (
          <div className="flex h-20 items-center justify-center rounded-md border border-dashed border-border text-xs text-foreground-passive">
            No tasks
          </div>
        ) : (
          column.tasks.map((task) => (
            <KanbanTaskCard
              key={task.data.id}
              task={task}
              isSelected={selectedIds.has(task.data.id)}
              onToggleSelect={(shiftKey) => onToggleSelect(task.data.id, shiftKey)}
            />
          ))
        )}
      </div>
    </section>
  );
}

export const TaskKanbanBoard = observer(function TaskKanbanBoard({
  columns,
  selectedIds,
  onToggleSelect,
}: {
  columns: KanbanColumn<ReadyTask>[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string, shiftKey: boolean) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const tasksById = new Map(
    columns.flatMap((column) => column.tasks.map((task) => [task.data.id, task]))
  );

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTaskId(null);
    const taskId = parseTaskDndId(String(event.active.id));
    const targetColumn = event.over ? getKanbanColumnById(String(event.over.id)) : undefined;
    if (!taskId || !targetColumn) return;
    const task = tasksById.get(taskId);
    if (!task || KANBAN_COLUMN_BY_STATUS[task.data.status].id === targetColumn.id) return;
    void task.updateStatus(targetColumn.targetStatus);
  };

  const activeTask = activeTaskId ? tasksById.get(activeTaskId) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(event) => setActiveTaskId(parseTaskDndId(String(event.active.id)))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveTaskId(null)}
    >
      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden py-3">
        <div className="flex h-full min-h-[24rem] w-max gap-3 pr-1">
          {columns.map((column) => (
            <KanbanColumnView
              key={column.id}
              column={column}
              selectedIds={selectedIds}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {activeTask ? <KanbanTaskOverlay task={activeTask} /> : null}
      </DragOverlay>
    </DndContext>
  );
});
