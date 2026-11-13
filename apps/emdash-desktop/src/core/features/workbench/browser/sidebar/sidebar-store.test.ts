import { observable, runInAction } from 'mobx';
import { describe, expect, it, vi } from 'vitest';
import { taskManagerStoreToken } from '@core/features/tasks/contributions/browser/project-store-tokens';
import {
  workbenchSidebarGroupsMemento,
  type WorkbenchSidebarGroupsState,
  type WorkbenchSidebarState,
} from '@core/features/workbench/contributions/mementos';
import type { MementoHandle } from '@core/primitives/mementos/browser';
import { SidebarStore } from './sidebar-store';

type SidebarProjectManager = ConstructorParameters<typeof SidebarStore>[0];

vi.mock('@core/features/conversations/browser/acp/acp-chat-store', () => ({
  AcpChatStore: class {
    conversationId = '';
    dispose() {}
    bootstrap() {}
  },
}));

vi.mock('@core/features/conversations/browser/acp/acp-chat-panel', () => ({
  AcpChatPanel: () => null,
}));

function projectManager(projects: { id: string; createdAt: string }[]): SidebarProjectManager {
  return {
    projects: new Map(projects.map((p) => [p.id, { ...p, context: null }])),
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
      projects.map((project) => {
        const taskManager = {
          tasks: new Map(
            project.taskIds.map((taskId, index) => [
              taskId,
              task(taskId, `2026-01-01T00:00:0${index}.000Z`),
            ])
          ),
        };
        return [
          project.id,
          {
            id: project.id,
            createdAt: project.createdAt,
            context: {
              kind: 'available',
              context: {
                get: (token: unknown) =>
                  token === taskManagerStoreToken ? taskManager : undefined,
              },
            },
          },
        ];
      })
    ),
  } as unknown as SidebarProjectManager;
}

function mementoHandle(initial: WorkbenchSidebarState): MementoHandle<WorkbenchSidebarState> {
  let value = initial;
  return {
    get value() {
      return value;
    },
    ready: Promise.resolve(),
    isPending: false,
    hasStoredValue: true,
    read: () => value,
    update: (next) => {
      value = typeof next === 'function' ? next(value) : next;
    },
    reset: async () => {},
    flush: async () => {},
    autoPersist: () =>
      (() => {}) as ReturnType<MementoHandle<WorkbenchSidebarState>['autoPersist']>,
    dispose: async () => {},
  };
}

describe('SidebarStore project ordering', () => {
  it('keeps a restored collapsed project collapsed during initial task hydration', () => {
    const tasks = observable.map<string, ReturnType<typeof task>>();
    const project = observable({
      id: 'project-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      context: null as null | {
        kind: 'available';
        context: { get: () => { tasks: typeof tasks } };
      },
    });
    const manager = {
      projects: observable.map([['project-1', project]]),
    } as unknown as SidebarProjectManager;
    const handle = mementoHandle({
      version: '1',
      expandedProjectIds: [],
      projectOrder: [],
      taskOrderByProject: {},
      taskSortBy: 'created-at',
    });
    const store = new SidebarStore(manager);
    store.attachMemento(handle);

    runInAction(() => {
      project.context = {
        kind: 'available',
        context: { get: () => ({ tasks }) },
      };
    });
    runInAction(() => {
      tasks.set('task-1', task('task-1', '2026-01-01T00:00:00.000Z'));
    });

    expect([...store.expandedProjectIds]).toEqual([]);
    expect(handle.value.expandedProjectIds).toEqual([]);
  });

  it('reads and writes through an attached memento', () => {
    const store = new SidebarStore(projectManager([]));
    const handle = mementoHandle({
      version: '1',
      expandedProjectIds: ['project-1'],
      projectOrder: ['project-1'],
      taskOrderByProject: {},
      taskSortBy: 'updated-at',
    });

    store.attachMemento(handle);
    expect([...store.expandedProjectIds]).toEqual(['project-1']);
    expect(store.taskSortBy).toBe('updated-at');

    store.setTaskSortBy('created-at');
    expect(handle.value.taskSortBy).toBe('created-at');
  });

  it('reveals a project without changing its persisted expansion preference', () => {
    const store = new SidebarStore(projectManager([{ id: 'project-1', createdAt: '2026-01-01' }]));
    const handle = mementoHandle({
      version: '1',
      expandedProjectIds: [],
      projectOrder: [],
      taskOrderByProject: {},
      taskSortBy: 'created-at',
    });
    store.attachMemento(handle);

    store.revealProject('project-1');
    expect([...store.expandedProjectIds]).toEqual(['project-1']);
    expect(handle.value.expandedProjectIds).toEqual([]);

    store.toggleProjectExpanded('project-1');
    expect([...store.expandedProjectIds]).toEqual([]);
    expect(handle.value.expandedProjectIds).toEqual([]);
  });

  it('folds every project while dragging without changing the stored expansion', () => {
    const store = new SidebarStore(projectManager([{ id: 'project-1', createdAt: '2026-01-01' }]));
    const handle = mementoHandle({
      version: '1',
      expandedProjectIds: ['project-1'],
      projectOrder: [],
      taskOrderByProject: {},
      taskSortBy: 'created-at',
    });
    store.attachMemento(handle);

    store.beginDragFold('project');
    expect(store.isDragFolded).toBe(true);
    expect([...store.expandedProjectIds]).toEqual([]);

    store.endDragFold();
    expect(store.isDragFolded).toBe(false);
    expect([...store.expandedProjectIds]).toEqual(['project-1']);
    expect(handle.value.expandedProjectIds).toEqual(['project-1']);
  });

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
    store.toggleProjectExpanded('project-1');
    store.toggleProjectExpanded('project-2');
    store.setTaskOrder('project-1', ['task-1a', 'task-1b']);

    expect(store.visibleTaskEntries).toEqual([
      { projectId: 'project-1', taskId: 'task-1a' },
      { projectId: 'project-1', taskId: 'task-1b' },
      { projectId: 'project-2', taskId: 'task-2a' },
    ]);
  });

  it('excludes pinned automation runs from every sidebar selector', () => {
    const manager = projectManagerWithTasks([
      {
        id: 'project-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        taskIds: ['regular-task', 'automation-task'],
      },
    ]);
    const project = manager.projects.get('project-1')!;
    const context = project.context?.kind === 'available' ? project.context.context : undefined;
    const tasks = context!.get(taskManagerStoreToken).tasks;
    tasks.get('regular-task')!.data.isPinned = true;
    tasks.get('automation-task')!.data.isPinned = true;
    tasks.get('automation-task')!.data.type = 'automation-run';

    const store = new SidebarStore(manager);
    store.toggleProjectExpanded('project-1');

    expect(store.pinnedSidebarEntries).toEqual([
      { projectId: 'project-1', taskId: 'regular-task' },
    ]);
    expect(store.visibleTaskIdsForProject('project-1')).toEqual([]);
    expect(store.sidebarRows).toEqual([{ kind: 'project', projectId: 'project-1' }]);
  });
});

describe('SidebarStore project groups', () => {
  function threeProjects() {
    // Default order is newest first: c, b, a.
    return new SidebarStore(
      projectManager([
        { id: 'a', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'b', createdAt: '2026-01-02T00:00:00.000Z' },
        { id: 'c', createdAt: '2026-01-03T00:00:00.000Z' },
      ])
    );
  }

  it('lists ungrouped projects first, then each group with its projects', () => {
    const store = threeProjects();
    const groupId = store.createGroup('Customers', 'b');

    expect(store.sidebarRows).toEqual([
      { kind: 'project', projectId: 'c' },
      { kind: 'project', projectId: 'a' },
      { kind: 'group', groupId },
      { kind: 'project', projectId: 'b' },
    ]);
  });

  it('hides projects of a collapsed group but keeps the header', () => {
    const store = threeProjects();
    const groupId = store.createGroup('Customers', 'b');
    store.toggleGroupCollapsed(groupId);

    expect(store.sidebarRows).toEqual([
      { kind: 'project', projectId: 'c' },
      { kind: 'project', projectId: 'a' },
      { kind: 'group', groupId },
    ]);
  });

  it('folds every group while a group is dragged and restores them afterwards', () => {
    const store = threeProjects();
    const handle = groupsMementoHandle();
    store.attachGroupsMemento(handle);
    const groupId = store.createGroup('Customers', 'b');

    store.beginDragFold('group');
    expect(store.isGroupCollapsed(groupId)).toBe(true);
    expect(store.sidebarRows).not.toContainEqual({ kind: 'project', projectId: 'b' });

    store.endDragFold();
    expect(store.isGroupCollapsed(groupId)).toBe(false);
    expect(handle.value.groups[0]?.collapsed).toBe(false);
  });

  it('opens a hovered group while dragging a project, keeping it open only when dropped into', () => {
    const store = threeProjects();
    const handle = groupsMementoHandle();
    store.attachGroupsMemento(handle);
    const groupId = store.createGroup('Customers', 'b');
    store.toggleGroupCollapsed(groupId);

    store.beginDragFold('project');
    store.openGroupWhileDragging(groupId);
    expect(store.sidebarRows).toContainEqual({ kind: 'project', projectId: 'b' });
    store.endDragFold();
    expect(store.isGroupCollapsed(groupId)).toBe(true);

    store.beginDragFold('project');
    store.openGroupWhileDragging(groupId);
    store.endDragFold(groupId);
    expect(store.isGroupCollapsed(groupId)).toBe(false);
    expect(handle.value.groups[0]?.collapsed).toBe(false);
  });

  it('reveals a collapsed group for navigation without persisting it', () => {
    const store = threeProjects();
    const handle = groupsMementoHandle();
    store.attachGroupsMemento(handle);
    const groupId = store.createGroup('Customers', 'b');
    store.toggleGroupCollapsed(groupId);

    store.revealProject('b');
    expect(store.isGroupCollapsed(groupId)).toBe(false);
    expect(store.sidebarRows).toContainEqual({ kind: 'project', projectId: 'b' });
    expect(handle.value.groups[0]?.collapsed).toBe(true);

    store.toggleGroupCollapsed(groupId);
    expect(store.isGroupCollapsed(groupId)).toBe(true);
    expect(handle.value.groups[0]?.collapsed).toBe(true);
  });

  it('places a project inside a group, expanding it and persisting display order', () => {
    const store = threeProjects();
    const groupId = store.createGroup('Customers', 'b');
    store.toggleGroupCollapsed(groupId);
    store.placeProject('c', groupId, 1);

    expect(store.groupIdForProject('c')).toBe(groupId);
    expect(store.isGroupCollapsed(groupId)).toBe(false);
    expect(store.projectSections.map((s) => s.projectIds)).toEqual([['a'], ['b', 'c']]);
    expect(store.projectOrder).toEqual(['a', 'b', 'c']);
  });

  it('drops mappings for projects that no longer exist when writing', () => {
    const store = threeProjects();
    const handle = groupsMementoHandle({
      version: '1',
      groups: [{ id: 'g', name: 'Old', collapsed: false }],
      groupByProjectId: { removed: 'g' },
    });
    store.attachGroupsMemento(handle);
    store.moveProjectToGroup('a', 'g');

    expect(handle.value.groupByProjectId).toEqual({ a: 'g' });
  });

  it('keeps group edits made before the memento is attached', () => {
    const store = threeProjects();
    const groupId = store.createGroup('Early', 'a');
    const handle = groupsMementoHandle({
      version: '1',
      groups: [{ id: 'saved', name: 'Saved', collapsed: false }],
      groupByProjectId: { b: 'saved' },
    });
    store.attachGroupsMemento(handle);

    expect(handle.value.groups.map((g) => g.name)).toEqual(['Saved', 'Early']);
    expect(handle.value.groupByProjectId).toEqual({ a: groupId, b: 'saved' });
  });

  it('ungroups projects when their group is deleted', () => {
    const store = threeProjects();
    const groupId = store.createGroup('Customers', 'b');
    store.deleteGroup(groupId);

    expect(store.projectGroups).toEqual([]);
    expect(store.groupIdForProject('b')).toBeUndefined();
    expect(store.sidebarRows.every((row) => row.kind === 'project')).toBe(true);
  });

  it('moves groups up and down within bounds', () => {
    const store = threeProjects();
    store.createGroup('First');
    const second = store.createGroup('Second');
    store.moveGroup(second, -1);
    expect(store.projectGroups.map((g) => g.name)).toEqual(['Second', 'First']);

    store.moveGroup(second, -1);
    expect(store.projectGroups.map((g) => g.name)).toEqual(['Second', 'First']);
  });

  it('moves a group to a drop position counted before removal', () => {
    const store = threeProjects();
    const a = store.createGroup('A');
    store.createGroup('B');
    store.createGroup('C');

    store.moveGroupTo(a, 3);
    expect(store.projectGroups.map((g) => g.name)).toEqual(['B', 'C', 'A']);

    store.moveGroupTo(a, 0);
    expect(store.projectGroups.map((g) => g.name)).toEqual(['A', 'B', 'C']);

    store.moveGroupTo(a, 1);
    expect(store.projectGroups.map((g) => g.name)).toEqual(['A', 'B', 'C']);

    store.moveGroup(a, 1);
    expect(store.projectGroups.map((g) => g.name)).toEqual(['B', 'A', 'C']);
  });
});

function groupsMementoHandle(
  initial: WorkbenchSidebarGroupsState = workbenchSidebarGroupsMemento.default
): MementoHandle<WorkbenchSidebarGroupsState> {
  let value = initial;
  return {
    get value() {
      return value;
    },
    ready: Promise.resolve(),
    isPending: false,
    hasStoredValue: true,
    read: () => value,
    update: (next) => {
      value = typeof next === 'function' ? next(value) : next;
    },
    reset: async () => {},
    flush: async () => {},
    autoPersist: () =>
      (() => {}) as ReturnType<MementoHandle<WorkbenchSidebarGroupsState>['autoPersist']>,
    dispose: async () => {},
  };
}
