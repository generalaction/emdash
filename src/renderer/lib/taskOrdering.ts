import { normalizeSqliteTimestamp } from './utils';
import type { Task } from '../types/app';

export type TaskSortMode = 'last-active' | 'created' | 'alphabetical' | 'manual';

export const DEFAULT_TASK_SORT_MODE: TaskSortMode = 'created';

const taskNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

function getTimestamp(value?: string | null): number {
  if (!value) return 0;

  const normalized = normalizeSqliteTimestamp(value);
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compareCreatedDesc(left: Task, right: Task): number {
  const diff = getTimestamp(right.createdAt) - getTimestamp(left.createdAt);
  if (diff !== 0) return diff;
  return taskNameCollator.compare(left.name, right.name);
}

function comparePinned(left: Task, right: Task): number {
  return Number(Boolean(right.metadata?.isPinned)) - Number(Boolean(left.metadata?.isPinned));
}

export function mergeManualTaskOrder(taskIds: string[], storedOrder: string[]): string[] {
  const validTaskIds = new Set(taskIds);
  const seen = new Set<string>();

  const retained = storedOrder.filter((taskId) => {
    if (!validTaskIds.has(taskId) || seen.has(taskId)) return false;
    seen.add(taskId);
    return true;
  });

  const missing = taskIds.filter((taskId) => !seen.has(taskId));
  return [...missing, ...retained];
}

export function sortTasks(tasks: Task[], mode: TaskSortMode, manualOrder: string[] = []): Task[] {
  const ordered = [...tasks];

  if (mode === 'manual') {
    const normalizedManualOrder = mergeManualTaskOrder(
      ordered.map((task) => task.id),
      manualOrder
    );
    const orderIndex = new Map(normalizedManualOrder.map((taskId, index) => [taskId, index]));

    ordered.sort((left, right) => {
      const leftIndex = orderIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = orderIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      return compareCreatedDesc(left, right);
    });

    return ordered;
  }

  ordered.sort((left, right) => {
    const pinDiff = comparePinned(left, right);
    if (pinDiff !== 0) return pinDiff;

    if (mode === 'alphabetical') {
      const nameDiff = taskNameCollator.compare(left.name, right.name);
      if (nameDiff !== 0) return nameDiff;
      return compareCreatedDesc(left, right);
    }

    if (mode === 'last-active') {
      const activityDiff =
        getTimestamp(right.lastActivityAt ?? right.updatedAt ?? right.createdAt) -
        getTimestamp(left.lastActivityAt ?? left.updatedAt ?? left.createdAt);
      if (activityDiff !== 0) return activityDiff;
      return compareCreatedDesc(left, right);
    }

    return compareCreatedDesc(left, right);
  });

  return ordered;
}
