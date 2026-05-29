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
  sidebarStore: {
    taskOrderByProject: {},
    setTaskOrder: vi.fn(),
  },
}));

import type { ProjectManagerStore } from '@renderer/features/projects/stores/project-manager';
import { createUnprovisionedTask } from '@renderer/features/tasks/stores/task-store';
import type { Task } from '@shared/tasks';
import { TASK_KIND } from '@shared/tasks';
import { SidebarStore } from './sidebar-store';

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

function makeSidebarStore(taskStores: Task[]) {
  const taskManager = {
    tasks: new Map(taskStores.map((data) => [data.id, createUnprovisionedTask(data)])),
  };
  const projectManager = {
    projects: new Map([
      [
        'project-1',
        {
          state: 'mounted',
          data: { id: 'project-1' },
          mountedProject: { taskManager },
        },
      ],
    ]),
  } as unknown as ProjectManagerStore;

  return new SidebarStore(projectManager);
}

describe('SidebarStore.mergeTaskOrder', () => {
  it('ignores stored chat ids when merging manual order for tasks', () => {
    const store = new SidebarStore({ projects: new Map() } as unknown as ProjectManagerStore);
    store.setTaskOrder('project-1', ['chat-1', 'chat-2']);

    const newer = createUnprovisionedTask(
      makeTask({ id: 'task-newer', createdAt: '2026-01-02T00:00:00.000Z' })
    );
    const older = createUnprovisionedTask(
      makeTask({ id: 'task-older', createdAt: '2026-01-01T00:00:00.000Z' })
    );

    const ordered = store.mergeTaskOrder('project-1', [newer, older]);

    expect(ordered.map((t) => t.data.id)).toEqual(['task-newer', 'task-older']);
  });

  it('preserves manual order for tasks when stored ids match', () => {
    const store = new SidebarStore({ projects: new Map() } as unknown as ProjectManagerStore);
    const first = createUnprovisionedTask(makeTask({ id: 'task-first' }));
    const second = createUnprovisionedTask(makeTask({ id: 'task-second' }));

    store.setTaskOrder('project-1', ['task-second', 'task-first']);
    const ordered = store.mergeTaskOrder('project-1', [first, second]);

    expect(ordered.map((t) => t.data.id)).toEqual(['task-second', 'task-first']);
  });
});

describe('SidebarStore.visibleTaskIdsForProject', () => {
  it('lists tasks before chats and includes both kinds', () => {
    const store = makeSidebarStore([
      makeTask({ id: 'chat-1', kind: TASK_KIND.Chat }),
      makeTask({ id: 'task-1', kind: TASK_KIND.Task }),
    ]);

    expect(store.visibleTaskIdsForProject('project-1')).toEqual(['task-1', 'chat-1']);
  });
});
