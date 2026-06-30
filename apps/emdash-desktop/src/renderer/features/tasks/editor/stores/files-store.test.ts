import type { FileNode, NodeId } from '@emdash/core/files';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileTreeProjectionChannel } from '@shared/core/fs/fsEvents';
import { FilesStore } from './files-store';

const WORKSPACE_PATH = '/repo';
const SUBSCRIPTION_ID = 'sub-1';

const mocks = vi.hoisted(() => ({
  openProjection: vi.fn(),
  registerDir: vi.fn(),
  unregisterDir: vi.fn(),
  revealPath: vi.fn(),
  closeProjection: vi.fn(),
  eventOn: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    workspace: {
      fileTree: {
        openProjection: mocks.openProjection,
        registerDir: mocks.registerDir,
        unregisterDir: mocks.unregisterDir,
        revealPath: mocks.revealPath,
        closeProjection: mocks.closeProjection,
      },
    },
  },
  events: {
    on: mocks.eventOn,
  },
}));

type Scope = NodeId | null;
type ProjectionScope = { scopeId: Scope; entries: FileNode[] };
type ProjectionPayload = {
  projectId: string;
  workspaceId: string;
  subscriptionId: string;
  version: number;
  scopes: ProjectionScope[];
};

function node(
  id: NodeId,
  path: string,
  type: 'file' | 'directory',
  parentId: NodeId | null = null,
  childrenLoaded = false
): FileNode {
  const parts = path.split('/').filter(Boolean);
  return {
    id,
    path,
    name: parts[parts.length - 1] ?? path,
    parentId,
    type,
    childrenLoaded,
  };
}

function openResult(rootEntries: FileNode[], version = 1) {
  return {
    success: true as const,
    data: {
      subscriptionId: SUBSCRIPTION_ID,
      version,
      scopes: [{ scopeId: null as Scope, entries: rootEntries }],
    },
  };
}

function versionResult(version: number) {
  return { success: true as const, data: { version } };
}

function createStore(): FilesStore {
  return new FilesStore('project-1', 'workspace-1', WORKSPACE_PATH);
}

async function flushAsyncWork(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
  }
}

describe('FilesStore', () => {
  let emit: ((payload: ProjectionPayload) => void) | undefined;

  beforeEach(() => {
    emit = undefined;
    mocks.openProjection.mockReset();
    mocks.registerDir.mockReset();
    mocks.unregisterDir.mockReset();
    mocks.revealPath.mockReset();
    mocks.closeProjection.mockReset();
    mocks.eventOn.mockReset();
    mocks.closeProjection.mockResolvedValue({ success: true, data: undefined });
    mocks.eventOn.mockImplementation(
      (
        channel: typeof fileTreeProjectionChannel,
        handler: (payload: ProjectionPayload) => void
      ) => {
        expect(channel).toBe(fileTreeProjectionChannel);
        emit = handler;
        return vi.fn();
      }
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function emitProjection(version: number, scopes: ProjectionScope[]): void {
    emit?.({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      subscriptionId: SUBSCRIPTION_ID,
      version,
      scopes,
    });
  }

  it('opens a projection and seeds the root scope without registering child directories', async () => {
    mocks.openProjection.mockResolvedValue(
      openResult([node(1, '/repo/src', 'directory'), node(2, '/repo/README.md', 'file')])
    );

    const store = createStore();
    await store.start();

    expect(mocks.openProjection).toHaveBeenCalledWith('project-1', 'workspace-1');
    expect(mocks.registerDir).not.toHaveBeenCalled();
    expect(store.loadedPaths.has('/repo')).toBe(true);
    expect(store.loadedPaths.has('/repo/src')).toBe(false);
    expect(store.rootNodes.map((entry) => entry.path)).toEqual(['/repo/src', '/repo/README.md']);
    store.dispose();
  });

  it('registers a child directory on demand and indexes children by parent id', async () => {
    mocks.openProjection.mockResolvedValue(openResult([node(1, '/repo/src', 'directory')]));
    mocks.registerDir.mockImplementation(async () => {
      emitProjection(2, [{ scopeId: 1, entries: [node(2, '/repo/src/index.ts', 'file', 1)] }]);
      return versionResult(2);
    });

    const store = createStore();
    await store.start();
    await store.registerDir('src');

    expect(mocks.registerDir).toHaveBeenCalledWith('project-1', 'workspace-1', SUBSCRIPTION_ID, 1);
    expect(store.loadedPaths.has('/repo/src')).toBe(true);
    expect(store.nodes.has('/repo/src/index.ts')).toBe(true);
    expect(store.childrenById.get(1)?.map((entry) => entry.path)).toEqual(['/repo/src/index.ts']);
    store.dispose();
  });

  it('sorts root nodes and loaded child buckets directories first', async () => {
    mocks.openProjection.mockResolvedValue(
      openResult([
        node(1, '/repo/z-file.ts', 'file'),
        node(2, '/repo/components', 'directory'),
        node(3, '/repo/a-file.ts', 'file'),
        node(4, '/repo/alpha', 'directory'),
      ])
    );
    mocks.registerDir.mockImplementation(async () => {
      emitProjection(2, [
        {
          scopeId: 2,
          entries: [
            node(5, '/repo/components/z.ts', 'file', 2),
            node(6, '/repo/components/a', 'directory', 2),
          ],
        },
      ]);
      return versionResult(2);
    });

    const store = createStore();
    await store.start();
    await store.registerDir('components');

    expect(store.rootNodes.map((entry) => entry.path)).toEqual([
      '/repo/alpha',
      '/repo/components',
      '/repo/a-file.ts',
      '/repo/z-file.ts',
    ]);
    expect(store.childrenById.get(2)?.map((entry) => entry.path)).toEqual([
      '/repo/components/a',
      '/repo/components/z.ts',
    ]);
    store.dispose();
  });

  it('replaces a scope wholesale when a projection snapshot arrives', async () => {
    mocks.openProjection.mockResolvedValue(openResult([node(1, '/repo/src', 'directory')]));
    mocks.registerDir.mockImplementation(async () => {
      emitProjection(2, [{ scopeId: 1, entries: [node(3, '/repo/src/a.ts', 'file', 1)] }]);
      return versionResult(2);
    });

    const store = createStore();
    await store.start();
    await store.registerDir('src');

    expect(store.childrenById.get(1)?.map((entry) => entry.path)).toEqual(['/repo/src/a.ts']);

    // A later snapshot of the same scope replaces its children wholesale.
    emitProjection(3, [
      {
        scopeId: 1,
        entries: [node(4, '/repo/src/b.ts', 'file', 1), node(5, '/repo/src/c.ts', 'file', 1)],
      },
    ]);
    await flushAsyncWork();

    expect(store.childrenById.get(1)?.map((entry) => entry.path)).toEqual([
      '/repo/src/b.ts',
      '/repo/src/c.ts',
    ]);
    expect(store.nodes.has('/repo/src/a.ts')).toBe(false);
    store.dispose();
  });

  it('prunes vanished sub-scopes when a parent scope snapshot drops a directory', async () => {
    mocks.openProjection.mockResolvedValue(openResult([node(1, '/repo/src', 'directory')]));
    let registerCall = 0;
    mocks.registerDir.mockImplementation(async () => {
      registerCall += 1;
      if (registerCall === 1) {
        emitProjection(2, [{ scopeId: 1, entries: [node(2, '/repo/src/nested', 'directory', 1)] }]);
        return versionResult(2);
      }
      emitProjection(3, [{ scopeId: 2, entries: [node(3, '/repo/src/nested/a.ts', 'file', 2)] }]);
      return versionResult(3);
    });

    const store = createStore();
    await store.start();
    await store.registerDir('src');
    await store.registerDir('src/nested');

    expect(store.nodes.has('/repo/src/nested/a.ts')).toBe(true);

    // src no longer contains nested; its sub-scope must be pruned.
    emitProjection(4, [{ scopeId: 1, entries: [] }]);
    await flushAsyncWork();

    expect(store.nodes.has('/repo/src/nested')).toBe(false);
    expect(store.nodes.has('/repo/src/nested/a.ts')).toBe(false);
    store.dispose();
  });

  it('reveals and expands ancestor directories for a file', async () => {
    mocks.openProjection.mockResolvedValue(openResult([node(1, '/repo/src', 'directory')]));
    mocks.revealPath.mockImplementation(async () => {
      emitProjection(2, [
        { scopeId: 1, entries: [node(2, '/repo/src/a', 'directory', 1)] },
        { scopeId: 2, entries: [node(3, '/repo/src/a/b.ts', 'file', 2)] },
      ]);
      return versionResult(2);
    });

    const store = createStore();
    const expandedPaths = new Set<string>();
    await store.start();
    await store.revealFile('src/a/b.ts', expandedPaths);

    expect(mocks.revealPath).toHaveBeenCalledWith(
      'project-1',
      'workspace-1',
      SUBSCRIPTION_ID,
      '/repo/src/a/b.ts'
    );
    expect([...expandedPaths]).toEqual(['/repo/src', '/repo/src/a']);
    expect(store.nodes.has('/repo/src/a/b.ts')).toBe(true);
    store.dispose();
  });

  it('unregisters a collapsed directory and forgets it is loaded', async () => {
    mocks.openProjection.mockResolvedValue(openResult([node(1, '/repo/src', 'directory')]));
    mocks.registerDir.mockImplementation(async () => {
      emitProjection(2, [{ scopeId: 1, entries: [node(2, '/repo/src/a.ts', 'file', 1)] }]);
      return versionResult(2);
    });
    mocks.unregisterDir.mockResolvedValue(versionResult(3));

    const store = createStore();
    await store.start();
    await store.registerDir('src');
    expect(store.loadedPaths.has('/repo/src')).toBe(true);

    await store.unregisterDir('src');

    expect(mocks.unregisterDir).toHaveBeenCalledWith(
      'project-1',
      'workspace-1',
      SUBSCRIPTION_ID,
      1
    );
    expect(store.loadedPaths.has('/repo/src')).toBe(false);
    store.dispose();
  });

  it('prefetches single-child directory chains for compaction while collapsed', async () => {
    mocks.openProjection.mockResolvedValue(openResult([node(1, '/repo/src', 'directory')]));
    mocks.registerDir.mockImplementation(async (_p, _w, _s, dirId) => {
      if (dirId === 1) {
        emitProjection(2, [{ scopeId: 1, entries: [node(2, '/repo/src/nested', 'directory', 1)] }]);
        return versionResult(2);
      }
      emitProjection(3, [
        { scopeId: 2, entries: [node(3, '/repo/src/nested/leaf.ts', 'file', 2)] },
      ]);
      return versionResult(3);
    });

    const store = createStore();
    await store.start();

    // Collapsed (no expanded paths): the visible `src` row is probed for compaction.
    store.reconcileVisibleScopes(new Set());
    await flushAsyncWork();
    expect(mocks.registerDir).toHaveBeenCalledWith('project-1', 'workspace-1', SUBSCRIPTION_ID, 1);

    // `src` resolved to a single sub-directory, so the chain extends and `nested` is auto-registered
    // without ever being expanded.
    store.reconcileVisibleScopes(new Set());
    await flushAsyncWork();
    expect(mocks.registerDir).toHaveBeenCalledWith('project-1', 'workspace-1', SUBSCRIPTION_ID, 2);
    expect(store.nodes.has('/repo/src/nested')).toBe(true);
    expect(store.nodes.has('/repo/src/nested/leaf.ts')).toBe(true);
    store.dispose();
  });

  it('probes a multi-child directory once without registering its file children', async () => {
    mocks.openProjection.mockResolvedValue(openResult([node(1, '/repo/src', 'directory')]));
    mocks.registerDir.mockImplementation(async () => {
      emitProjection(2, [
        {
          scopeId: 1,
          entries: [node(2, '/repo/src/a.ts', 'file', 1), node(3, '/repo/src/b.ts', 'file', 1)],
        },
      ]);
      return versionResult(2);
    });

    const store = createStore();
    await store.start();

    store.reconcileVisibleScopes(new Set());
    await flushAsyncWork();
    store.reconcileVisibleScopes(new Set());
    await flushAsyncWork();

    // Only `src` is registered (probed); its file children are not directories, so the chain stops
    // and nothing deeper is registered.
    expect(mocks.registerDir).toHaveBeenCalledTimes(1);
    expect(mocks.registerDir).toHaveBeenCalledWith('project-1', 'workspace-1', SUBSCRIPTION_ID, 1);
    expect(store.loadedPaths.has('/repo/src')).toBe(true);
    store.dispose();
  });

  it('unregisters a scope when it leaves the visible set on collapse', async () => {
    mocks.openProjection.mockResolvedValue(openResult([node(1, '/repo/src', 'directory')]));
    mocks.registerDir.mockImplementation(async (_p, _w, _s, dirId) => {
      if (dirId === 1) {
        emitProjection(2, [
          {
            scopeId: 1,
            entries: [
              node(2, '/repo/src/sub', 'directory', 1),
              node(3, '/repo/src/other.ts', 'file', 1),
            ],
          },
        ]);
        return versionResult(2);
      }
      emitProjection(3, [{ scopeId: 2, entries: [node(4, '/repo/src/sub/x.ts', 'file', 2)] }]);
      return versionResult(3);
    });
    mocks.unregisterDir.mockResolvedValue(versionResult(4));

    const store = createStore();
    await store.start();

    // Expand `src` (multi-child, so no compaction): probe `src`, then its child `sub` becomes a row.
    store.reconcileVisibleScopes(new Set(['/repo/src']));
    await flushAsyncWork();
    store.reconcileVisibleScopes(new Set(['/repo/src']));
    await flushAsyncWork();
    expect(mocks.registerDir).toHaveBeenCalledWith('project-1', 'workspace-1', SUBSCRIPTION_ID, 2);

    // Collapse `src`: `sub` is no longer visible and must be unregistered.
    store.reconcileVisibleScopes(new Set());
    await flushAsyncWork();
    expect(mocks.unregisterDir).toHaveBeenCalledWith(
      'project-1',
      'workspace-1',
      SUBSCRIPTION_ID,
      2
    );
    store.dispose();
  });

  it('adds optimistic nodes under loaded parents and reconciles them by path', async () => {
    mocks.openProjection.mockResolvedValue(
      openResult([node(1, '/repo/src', 'directory', null, true)])
    );
    mocks.registerDir.mockImplementation(async () => {
      emitProjection(2, [{ scopeId: 1, entries: [] }]);
      return versionResult(2);
    });

    const store = createStore();
    await store.start();
    await store.registerDir('src');

    expect(store.addOptimisticNodes([{ path: 'src/new.ts', type: 'file' }])).toEqual([
      '/repo/src/new.ts',
    ]);
    expect(store.nodes.get('/repo/src/new.ts')?.id).toBeLessThan(0);

    emitProjection(3, [{ scopeId: 1, entries: [node(2, '/repo/src/new.ts', 'file', 1)] }]);
    await flushAsyncWork();

    expect(store.nodes.get('/repo/src/new.ts')?.id).toBe(2);
    expect(store.childrenById.get(1)?.map((entry) => entry.path)).toEqual(['/repo/src/new.ts']);
    store.dispose();
  });

  it('rolls back optimistic nodes by path', async () => {
    mocks.openProjection.mockResolvedValue(
      openResult([node(1, '/repo/src', 'directory', null, true)])
    );
    mocks.registerDir.mockImplementation(async () => {
      emitProjection(2, [{ scopeId: 1, entries: [] }]);
      return versionResult(2);
    });

    const store = createStore();
    await store.start();
    await store.registerDir('src');
    store.addOptimisticNodes([{ path: 'src/new.ts', type: 'file' }]);
    store.removeNode('src/new.ts');

    expect(store.nodes.has('/repo/src/new.ts')).toBe(false);
    store.dispose();
  });

  it('expires unreconciled optimistic nodes after a safety timeout', async () => {
    vi.useFakeTimers();
    mocks.openProjection.mockResolvedValue(
      openResult([node(1, '/repo/src', 'directory', null, true)])
    );
    mocks.registerDir.mockImplementation(async () => {
      emitProjection(2, [{ scopeId: 1, entries: [] }]);
      return versionResult(2);
    });

    const store = createStore();
    await store.start();
    await store.registerDir('src');
    const inserted = store.addOptimisticNodes([{ path: 'src/new.ts', type: 'file' }]);

    expect(store.nodes.has('/repo/src/new.ts')).toBe(true);

    vi.advanceTimersByTime(15_000);
    expect(store.nodes.has('/repo/src/new.ts')).toBe(true);

    store.confirmOptimisticNodes(inserted);
    vi.advanceTimersByTime(15_000);

    expect(store.nodes.has('/repo/src/new.ts')).toBe(false);
    store.dispose();
  });
});
