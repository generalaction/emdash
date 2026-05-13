import type { TaskLifecycleStatus } from '@shared/tasks';

export interface SwitcherTask {
  id: string;
  name: string;
  status: TaskLifecycleStatus;
  lastInteractedAt: string;
}

function statusTier(status: TaskLifecycleStatus): number {
  if (status === 'review') return 0;
  if (status === 'in_progress') return 1;
  return 2;
}

export function sortTasksForSwitcher<T extends SwitcherTask>(
  tasks: T[],
  mruStack: string[] = []
): T[] {
  return [...tasks].sort((a, b) => {
    // Primary: status tier
    const tierDiff = statusTier(a.status) - statusTier(b.status);
    if (tierDiff !== 0) return tierDiff;

    // Secondary: MRU position (lower index = more recent)
    const aMru = mruStack.indexOf(a.id);
    const bMru = mruStack.indexOf(b.id);
    // -1 means not in stack — sort after visited tasks
    if (aMru !== -1 && bMru !== -1) return aMru - bMru;
    if (aMru !== -1) return -1;
    if (bMru !== -1) return 1;

    // Tertiary: lastInteractedAt for unvisited tasks
    return new Date(b.lastInteractedAt).getTime() - new Date(a.lastInteractedAt).getTime();
  });
}
