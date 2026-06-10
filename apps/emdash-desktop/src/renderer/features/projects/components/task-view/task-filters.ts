import { taskAgentStatus } from '@renderer/features/tasks/stores/task-selectors';
import type { TaskStore } from '@renderer/features/tasks/stores/task-store';
import type { AgentStatus } from '@shared/core/agents/agentEvents';
import { selectCurrentPr } from '@shared/core/pull-requests/pull-requests';
import type { Task } from '@shared/core/tasks/tasks';

export type FilterableTask = TaskStore & { data: Task };

export type TaskSortField = 'newest' | 'oldest' | 'recently-updated' | 'name';
export type TaskPrFilterValue = 'open' | 'merged' | 'closed' | 'none';
export type TaskChangesFilterValue = 'has-changes' | 'no-changes';

export const TASK_SORT_OPTIONS: readonly { value: TaskSortField; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'recently-updated', label: 'Recently updated' },
  { value: 'name', label: 'Name (A–Z)' },
];

export const AGENT_FILTER_OPTIONS: readonly { value: AgentStatus; label: string }[] = [
  { value: 'working', label: 'Working' },
  { value: 'awaiting-input', label: 'Awaiting input' },
  { value: 'completed', label: 'Completed' },
  { value: 'error', label: 'Error' },
  { value: 'idle', label: 'Idle' },
];

export const PR_FILTER_OPTIONS: readonly { value: TaskPrFilterValue; label: string }[] = [
  { value: 'open', label: 'Open PR' },
  { value: 'merged', label: 'Merged' },
  { value: 'closed', label: 'Closed' },
  { value: 'none', label: 'No PR' },
];

export const CHANGES_FILTER_OPTIONS: readonly { value: TaskChangesFilterValue; label: string }[] = [
  { value: 'has-changes', label: 'Has changes' },
  { value: 'no-changes', label: 'No changes' },
];

export type TaskFilters = {
  agent: ReadonlySet<AgentStatus>;
  pr: ReadonlySet<TaskPrFilterValue>;
  changes: ReadonlySet<TaskChangesFilterValue>;
};

function parseTime(value: string | undefined): number {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

function lastUpdatedTime(task: FilterableTask): number {
  return parseTime(task.data.lastInteractedAt ?? task.data.updatedAt ?? task.data.createdAt);
}

export function taskPrFilterValue(task: FilterableTask): TaskPrFilterValue {
  const pr = selectCurrentPr(task.data.prs ?? []);
  return pr ? pr.status : 'none';
}

export function taskChangesFilterValue(task: FilterableTask): TaskChangesFilterValue {
  const git = task.data.workspaceGit;
  return git && git.linesAdded + git.linesDeleted > 0 ? 'has-changes' : 'no-changes';
}

/** A task passes when it matches every active dimension (AND), with OR within a dimension. */
export function taskMatchesFilters(task: FilterableTask, filters: TaskFilters): boolean {
  if (filters.agent.size > 0 && !filters.agent.has(taskAgentStatus(task) ?? 'idle')) return false;
  if (filters.pr.size > 0 && !filters.pr.has(taskPrFilterValue(task))) return false;
  if (filters.changes.size > 0 && !filters.changes.has(taskChangesFilterValue(task))) return false;
  return true;
}

/** Pinned tasks always sort first; remaining order follows the chosen sort field. */
export function sortTasks<T extends FilterableTask>(tasks: T[], sortBy: TaskSortField): T[] {
  return [...tasks].sort((a, b) => {
    if (a.data.isPinned !== b.data.isPinned) return a.data.isPinned ? -1 : 1;
    switch (sortBy) {
      case 'newest':
        return parseTime(b.data.createdAt) - parseTime(a.data.createdAt);
      case 'oldest':
        return parseTime(a.data.createdAt) - parseTime(b.data.createdAt);
      case 'recently-updated':
        return lastUpdatedTime(b) - lastUpdatedTime(a);
      case 'name':
        return a.data.name.localeCompare(b.data.name);
    }
  });
}
