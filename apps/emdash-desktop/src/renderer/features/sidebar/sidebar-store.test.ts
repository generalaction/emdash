import { describe, expect, it, vi } from 'vitest';
import { SidebarStore } from './sidebar-store';

type SidebarProjectManager = ConstructorParameters<typeof SidebarStore>[0];

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn(),
  },
  rpc: {},
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {},
}));

function projectManager(projects: { id: string; createdAt: string }[]): SidebarProjectManager {
  return {
    projects: new Map(projects.map((p) => [p.id, { ...p, mountedProject: null }])),
  } as unknown as SidebarProjectManager;
}

function task(id: string, createdAt: string) {
  return {
    state: 'provisioned',
    data: {
      id,
      type: 'coding-agent',
      isPinned: false,
      createdAt,
      updatedAt: createdAt,
    },
  };
}

function projectManagerWithTasks(
  projects: { id: string; createdAt: string; taskIds: string[] }[]
): SidebarProjectManager {
  return {
    projects: new Map(
      projects.map((project) => [
        project.id,
        {
          id: project.id,
          createdAt: project.createdAt,
          mountedProject: {
            taskManager: {
              tasks: new Map(
                project.taskIds.map((taskId, index) => [
                  taskId,
                  task(taskId, `2026-01-01T00:00:0${index}.000Z`),
                ])
              ),
            },
          },
        },
      ])
    ),
  } as unknown as SidebarProjectManager;
}

describe('SidebarStore project ordering', () => {
  it('sorts projects newest first by default', () => {
    const store = new SidebarStore(
      projectManager([
        { id: 'old', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'new', createdAt: '2026-01-02T00:00:00.000Z' },
      ])
    );

    expect(store.orderedProjects.map((project) => project.id)).toEqual(['new', 'old']);
  });

  it('places projects missing from a saved manual order first', () => {
    const store = new SidebarStore(
      projectManager([
        { id: 'old', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'manual', createdAt: '2026-01-02T00:00:00.000Z' },
        { id: 'new', createdAt: '2026-01-03T00:00:00.000Z' },
      ])
    );

    store.setProjectOrder(['manual', 'old']);

    expect(store.orderedProjects.map((project) => project.id)).toEqual(['new', 'manual', 'old']);
  });

  it('restores saved manual project and task order', () => {
    const store = new SidebarStore(
      projectManagerWithTasks([
        {
          id: 'project-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          taskIds: ['task-1a', 'task-1b'],
        },
        {
          id: 'project-2',
          createdAt: '2026-01-02T00:00:00.000Z',
          taskIds: ['task-2a'],
        },
      ])
    );

    store.restoreSnapshot({
      expandedProjectIds: ['project-1', 'project-2'],
      projectOrder: ['project-1', 'project-2'],
      taskOrderByProject: { 'project-1': ['task-1a', 'task-1b'] },
    });

    expect(store.orderedProjects.map((project) => project.id)).toEqual(['project-1', 'project-2']);
    expect(store.visibleTaskIdsForProject('project-1')).toEqual(['task-1a', 'task-1b']);
  });

  it('requests an immediate save after manual project order changes', () => {
    const saveSnapshotNow = vi.fn();
    const store = new SidebarStore(
      projectManager([
        { id: 'old', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'new', createdAt: '2026-01-02T00:00:00.000Z' },
      ]),
      saveSnapshotNow
    );

    store.setProjectOrder(['old', 'new']);

    expect(saveSnapshotNow).toHaveBeenCalledOnce();
    expect(store.snapshot.projectOrder).toEqual(['old', 'new']);
  });

  it('requests an immediate save after manual task order changes', () => {
    const saveSnapshotNow = vi.fn();
    const store = new SidebarStore(
      projectManagerWithTasks([
        {
          id: 'project-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          taskIds: ['task-1a', 'task-1b'],
        },
      ]),
      saveSnapshotNow
    );

    store.setTaskOrder('project-1', ['task-1b', 'task-1a']);

    expect(saveSnapshotNow).toHaveBeenCalledOnce();
    expect(store.snapshot.taskOrderByProject).toEqual({
      'project-1': ['task-1b', 'task-1a'],
    });
  });

  it('requests an immediate save after applying a sort', () => {
    const saveSnapshotNow = vi.fn();
    const store = new SidebarStore(
      projectManagerWithTasks([
        {
          id: 'project-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          taskIds: ['task-1a', 'task-1b'],
        },
      ]),
      saveSnapshotNow
    );

    store.setTaskOrder('project-1', ['task-1b', 'task-1a']);
    saveSnapshotNow.mockClear();

    store.applySort('updated-at');

    expect(saveSnapshotNow).toHaveBeenCalledOnce();
    expect(store.snapshot.taskSortBy).toBe('updated-at');
    expect(store.snapshot.taskOrderByProject).toEqual({});
  });

  it('returns visible task entries in rendered project-tree order', () => {
    const store = new SidebarStore(
      projectManagerWithTasks([
        {
          id: 'project-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          taskIds: ['task-1a', 'task-1b'],
        },
        {
          id: 'project-2',
          createdAt: '2026-01-02T00:00:00.000Z',
          taskIds: ['task-2a'],
        },
      ])
    );

    store.setProjectOrder(['project-1', 'project-2']);
    store.ensureProjectExpanded('project-1');
    store.ensureProjectExpanded('project-2');
    store.setTaskOrder('project-1', ['task-1a', 'task-1b']);

    expect(store.visibleTaskEntries).toEqual([
      { projectId: 'project-1', taskId: 'task-1a' },
      { projectId: 'project-1', taskId: 'task-1b' },
      { projectId: 'project-2', taskId: 'task-2a' },
    ]);
  });
});
