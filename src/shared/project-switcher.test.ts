import { describe, expect, it } from 'vitest';
import { APP_SHORTCUTS } from '@shared/shortcuts';
import type { TaskLifecycleStatus } from '@shared/tasks';
import { sortTasksForSwitcher } from './project-switcher';

function makeTask(status: TaskLifecycleStatus, lastInteractedAt: string) {
  return { id: crypto.randomUUID(), name: `task-${status}`, status, lastInteractedAt };
}

describe('sortTasksForSwitcher', () => {
  it('places tasks requiring input (in_progress, review) before others', () => {
    const done = makeTask('done', '2026-05-13T10:00:00Z');
    const inProgress = makeTask('in_progress', '2026-05-13T09:00:00Z');
    const review = makeTask('review', '2026-05-13T08:00:00Z');
    const todo = makeTask('todo', '2026-05-13T11:00:00Z');

    const sorted = sortTasksForSwitcher([done, inProgress, review, todo]);

    // in_progress and review come first (input-needed), then the rest
    expect(sorted.map((t) => t.status)).toEqual(['in_progress', 'review', 'todo', 'done']);
  });

  it('sorts within each group by recency (most recent first)', () => {
    const ip1 = makeTask('in_progress', '2026-05-13T08:00:00Z');
    const ip2 = makeTask('in_progress', '2026-05-13T10:00:00Z');
    const done1 = makeTask('done', '2026-05-13T09:00:00Z');
    const done2 = makeTask('done', '2026-05-13T11:00:00Z');

    const sorted = sortTasksForSwitcher([ip1, ip2, done1, done2]);

    expect(sorted[0]).toBe(ip2); // more recent in_progress first
    expect(sorted[1]).toBe(ip1);
    expect(sorted[2]).toBe(done2); // more recent done first
    expect(sorted[3]).toBe(done1);
  });

  it('when no task is waiting for input, first item is the most recently accessed', () => {
    const todo = makeTask('todo', '2026-05-13T08:00:00Z');
    const done1 = makeTask('done', '2026-05-13T11:00:00Z');
    const done2 = makeTask('done', '2026-05-13T09:00:00Z');
    const cancelled = makeTask('cancelled', '2026-05-13T10:00:00Z');

    const sorted = sortTasksForSwitcher([todo, done1, done2, cancelled]);

    expect(sorted[0]).toBe(done1); // most recently accessed is first
    expect(sorted[1]).toBe(cancelled);
    expect(sorted[2]).toBe(done2);
    expect(sorted[3]).toBe(todo);
  });
});

describe('projectSwitcher shortcut', () => {
  it('is registered in APP_SHORTCUTS with Mod+E', () => {
    expect(APP_SHORTCUTS.projectSwitcher).toBeDefined();
    expect(APP_SHORTCUTS.projectSwitcher.defaultHotkey).toBe('Mod+E');
    expect(APP_SHORTCUTS.projectSwitcher.category).toBe('Navigation');
  });
});
