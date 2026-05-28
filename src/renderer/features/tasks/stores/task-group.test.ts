import { describe, expect, it, vi } from 'vitest';

vi.mock('@renderer/lib/ipc', () => ({
  events: { on: () => () => {} },
  rpc: {},
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    sshConnections: { start: vi.fn() },
    navigation: { currentViewId: 'home', viewParamsStore: {}, revalidate: vi.fn() },
  },
}));

import type { Task } from '@shared/tasks';
import { TASK_KIND, TASK_SIDEBAR_GROUP } from '@shared/tasks';
import { partitionTasksBySidebarGroup, taskSidebarGroupForStore } from './task-group';
import {
  createUnprovisionedTask,
  createUnregisteredTask,
  taskViewProfileForStore,
} from './task-store';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    projectId: 'project-1',
    name: 'Task 1',
    kind: TASK_KIND.Task,
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

describe('taskSidebarGroupForStore', () => {
  it('groups registered chats under chats', () => {
    const store = createUnprovisionedTask(makeTask({ kind: TASK_KIND.Chat }));
    expect(taskSidebarGroupForStore(store)).toBe(TASK_SIDEBAR_GROUP.Chats);
  });

  it('groups optimistic unregistered chats under chats', () => {
    const store = createUnregisteredTask({
      id: 'chat-1',
      name: 'chat-may-27',
      kind: TASK_KIND.Chat,
      status: 'in_progress',
      lastInteractedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      statusChangedAt: '2026-01-01T00:00:00.000Z',
      isPinned: false,
    });
    expect(taskSidebarGroupForStore(store)).toBe(TASK_SIDEBAR_GROUP.Chats);
  });

  it('defaults optimistic unregistered tasks to the tasks group', () => {
    const store = createUnregisteredTask({
      id: 'task-1',
      name: 'Creating…',
      kind: TASK_KIND.Task,
      status: 'in_progress',
      lastInteractedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      statusChangedAt: '2026-01-01T00:00:00.000Z',
      isPinned: false,
    });
    expect(taskSidebarGroupForStore(store)).toBe(TASK_SIDEBAR_GROUP.Tasks);
  });
});

describe('partitionTasksBySidebarGroup', () => {
  it('partitions registered tasks by kind', () => {
    const chat = createUnprovisionedTask(makeTask({ id: 'chat-1', kind: TASK_KIND.Chat }));
    const task = createUnprovisionedTask(makeTask({ id: 'task-1', kind: TASK_KIND.Task }));

    const groups = partitionTasksBySidebarGroup([chat, task]);

    expect(groups[TASK_SIDEBAR_GROUP.Chats].map((t) => t.data.id)).toEqual(['chat-1']);
    expect(groups[TASK_SIDEBAR_GROUP.Tasks].map((t) => t.data.id)).toEqual(['task-1']);
  });

  it('includes unregistered chats in the chats group', () => {
    const creatingChat = createUnregisteredTask({
      id: 'chat-1',
      name: 'chat-may-27',
      kind: TASK_KIND.Chat,
      status: 'in_progress',
      lastInteractedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      statusChangedAt: '2026-01-01T00:00:00.000Z',
      isPinned: false,
    });

    const groups = partitionTasksBySidebarGroup([creatingChat]);

    expect(groups[TASK_SIDEBAR_GROUP.Chats]).toHaveLength(1);
    expect(groups[TASK_SIDEBAR_GROUP.Tasks]).toHaveLength(0);
  });
});

describe('taskViewProfileForStore', () => {
  it('hides git chrome for optimistic unregistered chats', () => {
    const store = createUnregisteredTask({
      id: 'chat-1',
      name: 'chat-may-27',
      kind: TASK_KIND.Chat,
      status: 'in_progress',
      lastInteractedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      statusChangedAt: '2026-01-01T00:00:00.000Z',
      isPinned: false,
    });

    expect(taskViewProfileForStore(store).showGitChrome).toBe(false);
    expect(taskViewProfileForStore(store).group).toBe(TASK_SIDEBAR_GROUP.Chats);
  });
});
