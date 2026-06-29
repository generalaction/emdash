import { describe, expect, it } from 'vitest';
import type { Task } from '@shared/core/tasks/tasks';
import {
  buildKanbanColumns,
  KANBAN_STATUS_COLUMNS,
  type KanbanReadyTask,
} from './kanban-task-model';

function makeTask(id: string, overrides: Partial<Task> = {}): KanbanReadyTask {
  return {
    state: 'unprovisioned',
    data: {
      id,
      projectId: 'project-1',
      name: id,
      status: 'todo',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      statusChangedAt: '2026-01-01T00:00:00.000Z',
      isPinned: false,
      prs: [],
      conversations: {},
      type: 'task',
      ...overrides,
    },
  } as KanbanReadyTask;
}

describe('kanban task model', () => {
  it('uses the agent task flow column order', () => {
    expect(KANBAN_STATUS_COLUMNS.map((column) => column.label)).toEqual([
      'Backlog',
      'Prompting',
      'Working',
      'PR/Review',
      'Done',
      'Cancelled',
    ]);
  });

  it('groups active ready tasks by board column while excluding archived and automation tasks', () => {
    const columns = buildKanbanColumns(
      [
        makeTask('todo-a', { status: 'todo' }),
        makeTask('triage-a', { status: 'triage' }),
        makeTask('review-a', { status: 'review' }),
        makeTask('duplicate-a', { status: 'duplicate' }),
        makeTask('archived', { status: 'todo', archivedAt: '2026-01-03T00:00:00.000Z' }),
        makeTask('automation', { status: 'todo', type: 'automation-run' }),
      ],
      { tab: 'active', query: '' }
    );

    expect(
      columns.find((column) => column.id === 'prompting')?.tasks.map((task) => task.data.id)
    ).toEqual(['todo-a', 'triage-a']);
    expect(
      columns.find((column) => column.id === 'pr-review')?.tasks.map((task) => task.data.id)
    ).toEqual(['review-a']);
    expect(
      columns.find((column) => column.id === 'cancelled')?.tasks.map((task) => task.data.id)
    ).toEqual(['duplicate-a']);
  });

  it('filters archived tasks and search results the same way as the list view', () => {
    const columns = buildKanbanColumns(
      [
        makeTask('active-match', { name: 'Ship Kanban' }),
        makeTask('archived-match', {
          name: 'Archived Kanban',
          archivedAt: '2026-01-03T00:00:00.000Z',
        }),
        makeTask('archived-miss', {
          name: 'Archived List',
          archivedAt: '2026-01-03T00:00:00.000Z',
        }),
      ],
      { tab: 'archived', query: 'kanban' }
    );

    const ids = columns.flatMap((column) => column.tasks.map((task) => task.data.id));
    expect(ids).toEqual(['archived-match']);
  });

  it('sorts cards pinned first, then newest status change, then newest update', () => {
    const columns = buildKanbanColumns(
      [
        makeTask('older', {
          status: 'todo',
          statusChangedAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-05T00:00:00.000Z',
        }),
        makeTask('newer-status', {
          status: 'todo',
          statusChangedAt: '2026-01-03T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
        makeTask('same-status-newer-update', {
          status: 'todo',
          statusChangedAt: '2026-01-03T00:00:00.000Z',
          updatedAt: '2026-01-04T00:00:00.000Z',
        }),
        makeTask('pinned', {
          status: 'todo',
          isPinned: true,
          statusChangedAt: '2026-01-01T00:00:00.000Z',
        }),
      ],
      { tab: 'active', query: '' }
    );

    expect(
      columns.find((column) => column.id === 'prompting')?.tasks.map((task) => task.data.id)
    ).toEqual(['pinned', 'same-status-newer-update', 'newer-status', 'older']);
  });
});
