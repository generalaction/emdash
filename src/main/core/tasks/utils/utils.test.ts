import { describe, expect, it } from 'vitest';
import type { TaskRow } from '@main/db/schema';
import { DEFAULT_TASK_KIND, TASK_KIND } from '@shared/tasks';
import { mapTaskRowToTask } from './utils';

function makeTaskRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 'task-1',
    projectId: 'project-1',
    name: 'Task 1',
    kind: DEFAULT_TASK_KIND,
    status: 'in_progress',
    sourceBranch: null,
    taskBranch: null,
    linkedIssue: null,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastInteractedAt: null,
    statusChangedAt: '2026-01-01T00:00:00.000Z',
    isPinned: 0,
    workspaceProvider: null,
    workspaceId: null,
    workspaceProviderData: null,
    ...overrides,
  };
}

describe('mapTaskRowToTask', () => {
  it('passes through chat kind from the database row', () => {
    const task = mapTaskRowToTask(makeTaskRow({ id: 'chat-1', kind: TASK_KIND.Chat, name: 'chat-may-27' }));
    expect(task.kind).toBe(TASK_KIND.Chat);
  });

  it('passes through task kind from the database row', () => {
    const task = mapTaskRowToTask(makeTaskRow({ kind: TASK_KIND.Task }));
    expect(task.kind).toBe(TASK_KIND.Task);
  });
});
