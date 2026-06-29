import type { Task, TaskLifecycleStatus } from '@shared/core/tasks/tasks';

export type KanbanReadyTask = {
  data: Task;
};

export type KanbanColumnMeta = {
  id: string;
  label: string;
  statuses: readonly TaskLifecycleStatus[];
  targetStatus: TaskLifecycleStatus;
};

export type KanbanColumn<TTask extends KanbanReadyTask = KanbanReadyTask> = KanbanColumnMeta & {
  tasks: TTask[];
};

export const KANBAN_STATUS_COLUMNS = [
  { id: 'backlog', label: 'Backlog', statuses: ['backlog'], targetStatus: 'backlog' },
  {
    id: 'prompting',
    label: 'Prompting',
    statuses: ['triage', 'todo'],
    targetStatus: 'triage',
  },
  {
    id: 'working',
    label: 'Working',
    statuses: ['in_progress'],
    targetStatus: 'in_progress',
  },
  { id: 'pr-review', label: 'PR/Review', statuses: ['review'], targetStatus: 'review' },
  { id: 'done', label: 'Done', statuses: ['done'], targetStatus: 'done' },
  {
    id: 'cancelled',
    label: 'Cancelled',
    statuses: ['cancelled', 'duplicate'],
    targetStatus: 'cancelled',
  },
] as const satisfies KanbanColumnMeta[];

export const KANBAN_COLUMN_BY_ID = Object.fromEntries(
  KANBAN_STATUS_COLUMNS.map((column) => [column.id, column])
) as Record<string, KanbanColumnMeta>;

export const KANBAN_COLUMN_BY_STATUS = KANBAN_STATUS_COLUMNS.reduce(
  (columnsByStatus, column) => {
    for (const status of column.statuses) {
      columnsByStatus[status] = column;
    }
    return columnsByStatus;
  },
  {} as Record<TaskLifecycleStatus, KanbanColumnMeta>
);

function timestampValue(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compareTasks(a: KanbanReadyTask, b: KanbanReadyTask): number {
  if (a.data.isPinned !== b.data.isPinned) return a.data.isPinned ? -1 : 1;

  const statusDelta =
    timestampValue(b.data.statusChangedAt) - timestampValue(a.data.statusChangedAt);
  if (statusDelta !== 0) return statusDelta;

  const updatedDelta = timestampValue(b.data.updatedAt) - timestampValue(a.data.updatedAt);
  if (updatedDelta !== 0) return updatedDelta;

  return a.data.id.localeCompare(b.data.id);
}

export function buildKanbanColumns<TTask extends KanbanReadyTask>(
  tasks: TTask[],
  options: { tab: 'active' | 'archived'; query: string }
): KanbanColumn<TTask>[] {
  const query = options.query.trim().toLowerCase();
  const visibleTasks = tasks
    .filter((task) => task.data.type !== 'automation-run')
    .filter((task) =>
      options.tab === 'active' ? !task.data.archivedAt : Boolean(task.data.archivedAt)
    )
    .filter((task) => (query ? task.data.name.toLowerCase().includes(query) : true));

  const tasksByStatus = new Map<TaskLifecycleStatus, TTask[]>(
    KANBAN_STATUS_COLUMNS.flatMap((column) => column.statuses.map((status) => [status, []]))
  );

  for (const task of visibleTasks) {
    tasksByStatus.get(task.data.status)?.push(task);
  }

  return KANBAN_STATUS_COLUMNS.map((column) => ({
    ...column,
    tasks: column.statuses.flatMap((status) => tasksByStatus.get(status) ?? []).sort(compareTasks),
  }));
}
