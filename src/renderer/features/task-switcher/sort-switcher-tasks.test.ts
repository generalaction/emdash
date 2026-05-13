import { describe, expect, it } from 'vitest';
import type { TaskLifecycleStatus } from '@shared/tasks';
import { sortTasksForSwitcher } from './sort-switcher-tasks';

function makeTask(id: string, status: TaskLifecycleStatus, lastInteractedAt: string) {
  return { id, name: `task-${id}`, status, lastInteractedAt };
}

describe('sortTasksForSwitcher', () => {
  it('sorts by status tier: review > in_progress > rest', () => {
    const done = makeTask('d', 'done', '2026-05-13T10:00:00Z');
    const inProgress = makeTask('ip', 'in_progress', '2026-05-13T09:00:00Z');
    const review = makeTask('r', 'review', '2026-05-13T08:00:00Z');
    const todo = makeTask('t', 'todo', '2026-05-13T11:00:00Z');

    const sorted = sortTasksForSwitcher([done, inProgress, review, todo]);

    expect(sorted.map((t) => t.status)).toEqual(['review', 'in_progress', 'todo', 'done']);
  });

  it('sorts by lastInteractedAt within same tier when no MRU', () => {
    const ip1 = makeTask('ip1', 'in_progress', '2026-05-13T08:00:00Z');
    const ip2 = makeTask('ip2', 'in_progress', '2026-05-13T10:00:00Z');

    const sorted = sortTasksForSwitcher([ip1, ip2]);

    expect(sorted[0]).toBe(ip2);
    expect(sorted[1]).toBe(ip1);
  });

  it('MRU-visited tasks sort before unvisited within same tier', () => {
    const ip1 = makeTask('ip1', 'in_progress', '2026-05-13T10:00:00Z');
    const ip2 = makeTask('ip2', 'in_progress', '2026-05-13T08:00:00Z');

    const sorted = sortTasksForSwitcher([ip1, ip2], ['ip2']);

    expect(sorted[0]).toBe(ip2); // visited, despite older lastInteractedAt
    expect(sorted[1]).toBe(ip1);
  });

  it('MRU order is respected among visited tasks', () => {
    const a = makeTask('a', 'review', '2026-05-13T08:00:00Z');
    const b = makeTask('b', 'review', '2026-05-13T10:00:00Z');

    const sorted = sortTasksForSwitcher([a, b], ['b', 'a']);

    expect(sorted[0]).toBe(b); // index 0 in MRU
    expect(sorted[1]).toBe(a); // index 1 in MRU
  });

  it('status tier takes priority over MRU', () => {
    const review = makeTask('r', 'review', '2026-05-13T08:00:00Z');
    const todo = makeTask('t', 'todo', '2026-05-13T10:00:00Z');

    const sorted = sortTasksForSwitcher([todo, review], ['t', 'r']);

    expect(sorted[0]).toBe(review); // review tier wins despite todo visited more recently
    expect(sorted[1]).toBe(todo);
  });
});
