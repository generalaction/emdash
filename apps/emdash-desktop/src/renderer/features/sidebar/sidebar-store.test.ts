import { describe, expect, it, vi } from 'vitest';
import { rpc } from '@renderer/lib/ipc';
import { SnapshotRegistry } from '@renderer/lib/stores/snapshot-registry';
import { viewStateCache } from '@renderer/lib/stores/view-state-cache';
import type { SidebarSnapshot } from '@shared/view-state';
import { SidebarStore } from './sidebar-store';

type SidebarProjectManager = ConstructorParameters<typeof SidebarStore>[0];

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn(),
  },
  rpc: {
    viewState: {
      save: vi.fn(),
    },
  },
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {},
}));

vi.mock('@renderer/utils/logger', () => ({
  log: {
    error: vi.fn(),
  },
}));

vi.mock('@renderer/features/conversations/acp/acp-chat-store', () => ({
  AcpChatStore: class {
    conversationId = '';
    dispose() {}
    bootstrap() {}
  },
}));

vi.mock('@renderer/features/conversations/acp/acp-chat-panel', () => ({
  AcpChatPanel: () => null,
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

  it('synchronously persists and restores manual task order', () => {
    const projects = projectManagerWithTasks([
      {
        id: 'project-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        taskIds: ['task-1a', 'task-1b'],
      },
    ]);
    const store = new SidebarStore(projects);
    const dispose = new SnapshotRegistry().register('sidebar', () => store.snapshot, 0);
    vi.mocked(rpc.viewState.save).mockClear();

    store.setTaskOrder('project-1', ['task-1b', 'task-1a']);

    expect(rpc.viewState.save).toHaveBeenCalledTimes(1);
    expect(rpc.viewState.save).toHaveBeenCalledWith(
      'sidebar',
      expect.objectContaining({
        taskOrderByProject: { 'project-1': ['task-1b', 'task-1a'] },
      })
    );

    const restored = new SidebarStore(projects);
    const savedSnapshot = vi.mocked(rpc.viewState.save).mock.calls[0][1] as SidebarSnapshot;
    expect(() => structuredClone(savedSnapshot)).not.toThrow();
    restored.restoreSnapshot(savedSnapshot);
    expect(restored.visibleTaskIdsForProject('project-1')).toEqual(['task-1b', 'task-1a']);

    dispose();
  });

  it('flushes pending saves before reload and retains cached state after disposal', async () => {
    const projects = projectManagerWithTasks([
      {
        id: 'project-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        taskIds: ['task-1a', 'task-1b'],
      },
    ]);
    const store = new SidebarStore(projects);
    const registry = new SnapshotRegistry();
    const dispose = registry.register('sidebar', () => store.snapshot, 0);
    const pending = Promise.withResolvers<void>();
    vi.mocked(rpc.viewState.save).mockReset();
    vi.mocked(rpc.viewState.save).mockReturnValueOnce(pending.promise);

    store.setTaskOrder('project-1', ['task-1b', 'task-1a']);
    const flush = registry.flush();
    await Promise.resolve();

    expect(rpc.viewState.save).toHaveBeenCalledTimes(1);
    pending.resolve();
    await flush;
    expect(rpc.viewState.save).toHaveBeenCalledTimes(2);

    dispose();
    expect(viewStateCache.peek('sidebar')).toEqual(store.snapshot);
    registry.evict('sidebar');
    expect(viewStateCache.peek('sidebar')).toBeUndefined();
  });

  it('waits for reaction saves started during the canonical flush writes', async () => {
    const projects = projectManagerWithTasks([
      {
        id: 'project-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        taskIds: ['task-1a', 'task-1b'],
      },
    ]);
    const store = new SidebarStore(projects);
    const registry = new SnapshotRegistry();
    registry.register('sidebar', () => store.snapshot, 0);
    const canonicalSave = Promise.withResolvers<void>();
    const reactionSave = Promise.withResolvers<void>();
    vi.mocked(rpc.viewState.save).mockReset();
    vi.mocked(rpc.viewState.save)
      .mockReturnValueOnce(canonicalSave.promise)
      .mockReturnValueOnce(reactionSave.promise);

    let flushed = false;
    const flush = registry.flush().then(() => {
      flushed = true;
    });
    await vi.waitFor(() => expect(rpc.viewState.save).toHaveBeenCalledTimes(1));

    store.setTaskOrder('project-1', ['task-1b', 'task-1a']);
    expect(rpc.viewState.save).toHaveBeenCalledTimes(2);
    canonicalSave.resolve();
    await Promise.resolve();
    expect(flushed).toBe(false);

    reactionSave.resolve();
    await flush;
    expect(flushed).toBe(true);
    registry.evict('sidebar');
  });

  it('rejects failed flushes before and after the active registration is disposed', async () => {
    const projects = projectManagerWithTasks([
      {
        id: 'project-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        taskIds: ['task-1a', 'task-1b'],
      },
    ]);
    const store = new SidebarStore(projects);
    const registry = new SnapshotRegistry();
    const dispose = registry.register('sidebar', () => store.snapshot, 0);
    vi.mocked(rpc.viewState.save).mockReset();
    vi.mocked(rpc.viewState.save).mockRejectedValue(new Error('database is read-only'));

    store.setTaskOrder('project-1', ['task-1b', 'task-1a']);
    await Promise.resolve();

    await expect(registry.flush()).rejects.toThrow('database is read-only');
    dispose();
    vi.mocked(rpc.viewState.save).mockClear();

    await expect(registry.flush()).rejects.toThrow('database is read-only');
    expect(rpc.viewState.save).toHaveBeenLastCalledWith(
      'sidebar',
      expect.objectContaining({
        taskOrderByProject: { 'project-1': ['task-1b', 'task-1a'] },
      })
    );
    registry.evict('sidebar');
  });
});
