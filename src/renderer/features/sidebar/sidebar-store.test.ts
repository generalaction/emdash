import { observable } from 'mobx';
import { describe, expect, it, vi } from 'vitest';
import type { LocalProject } from '@shared/projects';
import type { ProjectStore } from '@renderer/features/projects/stores/project';
import type { ProjectManagerStore } from '@renderer/features/projects/stores/project-manager';
import type { TaskStore } from '@renderer/features/tasks/stores/task-store';
import { SidebarStore } from './sidebar-store';

vi.mock('@renderer/lib/ipc', () => ({
  events: { on: vi.fn() },
  rpc: new Proxy(
    {},
    {
      get: () =>
        new Proxy(
          {},
          {
            get: () => vi.fn(() => Promise.resolve({})),
          }
        ),
    }
  ),
}));

vi.mock('@renderer/features/tasks/stores/task-store', () => ({
  registeredTaskData: vi.fn((store: TaskStore) =>
    store.state === 'unregistered' ? undefined : store.data
  ),
  unregisteredTaskData: vi.fn((store: TaskStore) =>
    store.state === 'unregistered' ? store.data : undefined
  ),
}));

function localProject(id: string, name: string): LocalProject {
  return {
    type: 'local',
    id,
    name,
    path: `/tmp/${name}`,
    baseRef: 'main',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function createStore(projects: ProjectStore[]): SidebarStore {
  return new SidebarStore({
    projects: observable.map(projects.map((project) => [project.id, project] as const)),
  } as ProjectManagerStore);
}

function unmountedProject(id: string, name: string): ProjectStore {
  const data = localProject(id, name);
  return {
    state: 'unmounted',
    id,
    name,
    data,
    phase: 'idle',
    error: undefined,
    errorCode: undefined,
    mode: null,
    mountedProject: null,
  } as ProjectStore;
}

function mountedProject(id: string, name: string, tasks: TaskStore[]): ProjectStore {
  const data = localProject(id, name);
  return {
    state: 'mounted',
    id,
    name,
    data,
    phase: null,
    error: undefined,
    errorCode: undefined,
    mode: null,
    mountedProject: {
      data,
      taskManager: {
        tasks: observable.map(tasks.map((task) => [task.data.id, task] as const)),
      },
    },
  } as ProjectStore;
}

function task(
  id: string,
  {
    createdAt,
    lastInteractedAt,
  }: {
    createdAt: string;
    lastInteractedAt: string;
  }
): TaskStore {
  return {
    state: 'unprovisioned',
    data: {
      id,
      name: id,
      createdAt,
      updatedAt: lastInteractedAt,
      lastInteractedAt,
      isPinned: false,
    },
  } as TaskStore;
}

describe('SidebarStore', () => {
  it('sorts projects by name when project-name sort is selected', () => {
    const store = createStore([
      unmountedProject('z', 'Zulu'),
      unmountedProject('a', 'alpha'),
      unmountedProject('b', 'Beta'),
    ]);

    store.applySort('project-name');

    expect(store.orderedProjects.map((project) => project.id)).toEqual(['a', 'b', 'z']);
  });

  it('lets manual project order take precedence after project-name sort', () => {
    const store = createStore([
      unmountedProject('z', 'Zulu'),
      unmountedProject('a', 'Alpha'),
      unmountedProject('b', 'Beta'),
    ]);

    store.applySort('project-name');
    store.setProjectOrder(['z', 'b', 'a']);

    expect(store.orderedProjects.map((project) => project.id)).toEqual(['z', 'b', 'a']);
  });

  it('preserves the existing task sort when project-name sort is selected', () => {
    const store = createStore([
      mountedProject('p', 'Project', [
        task('older-created-recently-used', {
          createdAt: '2026-01-01T00:00:00.000Z',
          lastInteractedAt: '2026-01-10T00:00:00.000Z',
        }),
        task('newer-created-less-used', {
          createdAt: '2026-01-02T00:00:00.000Z',
          lastInteractedAt: '2026-01-05T00:00:00.000Z',
        }),
      ]),
    ]);

    store.setTaskSortBy('created-at');
    store.applySort('project-name');

    expect(store.visibleTaskIdsForProject('p')).toEqual([
      'newer-created-less-used',
      'older-created-recently-used',
    ]);
  });
});
