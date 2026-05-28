import { describe, expect, it } from 'vitest';
import type { Task } from '@shared/tasks';
import { taskSidebarGroupForKind, taskViewProfile } from '@shared/tasks';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    projectId: 'project-1',
    name: 'Task 1',
    kind: 'task',
    status: 'todo',
    sourceBranch: undefined,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    statusChangedAt: '2026-01-01T00:00:00.000Z',
    isPinned: false,
    prs: [],
    conversations: {},
    ...overrides,
  };
}

describe('taskSidebarGroupForKind', () => {
  it('maps task kind to tasks group', () => {
    expect(taskSidebarGroupForKind(makeTask({ kind: 'task' }).kind)).toBe('tasks');
  });

  it('maps chat kind to chats group', () => {
    expect(taskSidebarGroupForKind(makeTask({ kind: 'chat' }).kind)).toBe('chats');
  });
});

describe('taskViewProfile', () => {
  it('hides git and file chrome for chats group', () => {
    expect(taskViewProfile('chat')).toEqual({
      group: 'chats',
      showGitChrome: false,
      showChangesSidebar: false,
      showFilesSidebar: false,
      showFilePicker: false,
    });
  });

  it('shows full chrome for tasks group', () => {
    expect(taskViewProfile('task').group).toBe('tasks');
    expect(taskViewProfile('task').showGitChrome).toBe(true);
  });
});
