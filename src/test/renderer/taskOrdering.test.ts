import { describe, expect, it } from 'vitest';
import { sortTasks, mergeManualTaskOrder } from '../../renderer/lib/taskOrdering';
import type { Task } from '../../renderer/types/app';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? 'task-1',
    projectId: overrides.projectId ?? 'project-1',
    name: overrides.name ?? 'Task',
    branch: overrides.branch ?? 'main',
    path: overrides.path ?? `/tmp/${overrides.id ?? 'task-1'}`,
    status: overrides.status ?? 'idle',
    metadata: overrides.metadata ?? null,
    useWorktree: overrides.useWorktree ?? true,
    archivedAt: overrides.archivedAt ?? null,
    lastActivityAt: overrides.lastActivityAt ?? null,
    createdAt: overrides.createdAt ?? '2026-03-15 10:00:00',
    updatedAt: overrides.updatedAt ?? '2026-03-15 10:00:00',
    agentId: overrides.agentId,
  };
}

describe('taskOrdering', () => {
  it('sorts last-active tasks by recent activity while keeping pinned tasks first', () => {
    const result = sortTasks(
      [
        makeTask({
          id: 'older',
          name: 'Older',
          createdAt: '2026-03-15 08:00:00',
          lastActivityAt: '2026-03-15 09:00:00',
        }),
        makeTask({
          id: 'newer',
          name: 'Newer',
          createdAt: '2026-03-15 09:30:00',
          lastActivityAt: '2026-03-15 11:00:00',
        }),
        makeTask({
          id: 'pinned',
          name: 'Pinned',
          createdAt: '2026-03-15 07:00:00',
          lastActivityAt: '2026-03-15 08:30:00',
          metadata: { isPinned: true },
        }),
      ],
      'last-active'
    );

    expect(result.map((task) => task.id)).toEqual(['pinned', 'newer', 'older']);
  });

  it('sorts by creation date descending', () => {
    const result = sortTasks(
      [
        makeTask({ id: 'oldest', createdAt: '2026-03-14 08:00:00' }),
        makeTask({ id: 'newest', createdAt: '2026-03-16 08:00:00' }),
        makeTask({ id: 'middle', createdAt: '2026-03-15 08:00:00' }),
      ],
      'created'
    );

    expect(result.map((task) => task.id)).toEqual(['newest', 'middle', 'oldest']);
  });

  it('sorts alphabetically without case sensitivity', () => {
    const result = sortTasks(
      [
        makeTask({ id: 'zeta', name: 'zeta' }),
        makeTask({ id: 'alpha', name: 'Alpha' }),
        makeTask({ id: 'beta', name: 'beta' }),
      ],
      'alphabetical'
    );

    expect(result.map((task) => task.id)).toEqual(['alpha', 'beta', 'zeta']);
  });

  it('falls back to updatedAt when lastActivityAt is not available yet', () => {
    const result = sortTasks(
      [
        makeTask({
          id: 'older',
          lastActivityAt: null,
          updatedAt: '2026-03-15 09:00:00',
        }),
        makeTask({
          id: 'newer',
          lastActivityAt: null,
          updatedAt: '2026-03-15 11:00:00',
        }),
      ],
      'last-active'
    );

    expect(result.map((task) => task.id)).toEqual(['newer', 'older']);
  });

  it('merges new tasks ahead of the saved manual order', () => {
    expect(mergeManualTaskOrder(['task-c', 'task-b', 'task-a'], ['task-b', 'task-a'])).toEqual([
      'task-c',
      'task-b',
      'task-a',
    ]);
  });

  it('uses the saved manual order exactly when all tasks are already known', () => {
    const result = sortTasks(
      [
        makeTask({ id: 'task-a', name: 'Alpha', metadata: { isPinned: true } }),
        makeTask({ id: 'task-b', name: 'Beta' }),
      ],
      'manual',
      ['task-b', 'task-a']
    );

    expect(result.map((task) => task.id)).toEqual(['task-b', 'task-a']);
  });
});
