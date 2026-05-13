import type { TaskLifecycleStatus } from '@shared/tasks';

export interface SwitcherTask {
  id: string;
  name: string;
  status: TaskLifecycleStatus;
  lastInteractedAt: string;
}

const INPUT_NEEDED: Set<TaskLifecycleStatus> = new Set(['in_progress', 'review']);

export function sortTasksForSwitcher<T extends SwitcherTask>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    const aNeed = INPUT_NEEDED.has(a.status) ? 0 : 1;
    const bNeed = INPUT_NEEDED.has(b.status) ? 0 : 1;
    if (aNeed !== bNeed) return aNeed - bNeed;
    return b.lastInteractedAt.localeCompare(a.lastInteractedAt);
  });
}
