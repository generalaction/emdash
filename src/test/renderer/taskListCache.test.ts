import { describe, expect, it } from 'vitest';
import { upsertTaskInList } from '../../renderer/lib/taskListCache';
import type { Task } from '../../renderer/types/app';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? 'task-1',
    projectId: overrides.projectId ?? 'project-1',
    name: overrides.name ?? 'Task',
    branch: overrides.branch ?? 'main',
    path: overrides.path ?? '/tmp/task-1',
    status: overrides.status ?? 'active',
    useWorktree: overrides.useWorktree ?? true,
    metadata: overrides.metadata ?? null,
    agentId: overrides.agentId,
    archivedAt: overrides.archivedAt,
    createdAt: overrides.createdAt,
    updatedAt: overrides.updatedAt,
  };
}

describe('upsertTaskInList', () => {
  it('prepends a new task when it is not already cached', () => {
    const existingTask = makeTask({ id: 'task-1', path: '/tmp/task-1', name: 'Existing task' });
    const reviewTask = makeTask({ id: 'task-2', path: '/tmp/task-2', name: 'pr-42-fix-cache' });

    const result = upsertTaskInList([existingTask], reviewTask);

    expect(result).toEqual([reviewTask, existingTask]);
  });

  it('updates an existing task by id without changing its position', () => {
    const existingTask = makeTask({
      id: 'task-1',
      path: '/tmp/task-1',
      name: 'Old name',
      createdAt: '2026-03-14T10:00:00.000Z',
    });
    const otherTask = makeTask({ id: 'task-2', path: '/tmp/task-2', name: 'Other task' });

    const result = upsertTaskInList(
      [existingTask, otherTask],
      makeTask({
        id: 'task-1',
        path: '/tmp/task-1',
        name: 'pr-42-refresh-sidebar',
        metadata: { prNumber: 42, prTitle: 'Refresh sidebar' },
      })
    );

    expect(result).toEqual([
      {
        ...existingTask,
        name: 'pr-42-refresh-sidebar',
        metadata: { prNumber: 42, prTitle: 'Refresh sidebar' },
      },
      otherTask,
    ]);
  });

  it('updates by path when the task id changes to avoid duplicates', () => {
    const existingTask = makeTask({
      id: 'optimistic-review-task',
      path: '/tmp/review-task',
      name: 'PR #42',
      metadata: null,
    });

    const result = upsertTaskInList(
      [existingTask],
      makeTask({
        id: 'db-review-task',
        path: '/tmp/review-task',
        name: 'pr-42-refresh-sidebar',
        metadata: { prNumber: 42 },
      })
    );

    expect(result).toEqual([
      {
        ...existingTask,
        id: 'db-review-task',
        name: 'pr-42-refresh-sidebar',
        metadata: { prNumber: 42 },
      },
    ]);
  });
});
