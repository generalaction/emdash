import type { FileNode, FileTreeUpdate, NodeId } from '@emdash/core/files';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileTreeUpdateChannel } from '@shared/core/fs/fsEvents';
import { FilesStore } from './files-store';

const WORKSPACE_PATH = '/repo';

const mocks = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  expandDir: vi.fn(),
  revealPath: vi.fn(),
  eventOn: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    workspace: {
      fileTree: {
        getSnapshot: mocks.getSnapshot,
        expandDir: mocks.expandDir,
        revealPath: mocks.revealPath,
      },
    },
  },
  events: {
    on: mocks.eventOn,
  },
}));

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

function snapshot(entries: FileNode[], sequence = 1, generation = 1) {
  return {
    success: true as const,
    data: {
      entries: entries.map((entry) => [entry.id, entry] as [NodeId, FileNode]),
      generation,
      sequence,
    },
  };
}

function mutation(sequence: number) {
  return {
    success: true as const,
    data: {
      sequences: { tree: sequence },
    },
  };
}

function createStore(): FilesStore {
  return new FilesStore('project-1', 'workspace-1', WORKSPACE_PATH);
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('FilesStore', () => {
  let emit: ((payload: { workspaceId: string; update: FileTreeUpdate }) => void) | undefined;

  beforeEach(() => {
    emit = undefined;
    mocks.getSnapshot.mockReset();
    mocks.expandDir.mockReset();
    mocks.revealPath.mockReset();
    mocks.eventOn.mockReset();
    mocks.eventOn.mockImplementation(
      (channel: typeof fileTreeUpdateChannel, handler: typeof emit) => {
        expect(channel).toBe(fileTreeUpdateChannel);
        emit = handler;
        return vi.fn();
      }
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('hydrates from the file-tree snapshot without eagerly expanding directories', async () => {
    mocks.getSnapshot.mockResolvedValue(
      snapshot([node(1, '/repo/src', 'directory'), node(2, '/repo/README.md', 'file')])
    );

    const store = createStore();
    await store.tree.load();

    expect(mocks.getSnapshot).toHaveBeenCalledWith('project-1', 'workspace-1');
    expect(mocks.expandDir).not.toHaveBeenCalled();
    expect(store.loadedPaths.has('/repo')).toBe(true);
    expect(store.loadedPaths.has('/repo/src')).toBe(false);
    expect(store.rootNodes.map((entry) => entry.path)).toEqual(['/repo/src', '/repo/README.md']);
    store.dispose();
  });

  it('loads a child directory on demand and indexes children by parent id', async () => {
    mocks.getSnapshot.mockResolvedValue(snapshot([node(1, '/repo/src', 'directory')]));
    mocks.expandDir.mockImplementation(async () => {
      emit?.({
        workspaceId: 'workspace-1',
        update: {
          kind: 'delta',
          generation: 1,
          sequence: 2,
          ops: [
            { op: 'put', key: 1, value: node(1, '/repo/src', 'directory', null, true) },
            { op: 'put', key: 2, value: node(2, '/repo/src/index.ts', 'file', 1) },
          ],
        },
      });
      return mutation(2);
    });

    const store = createStore();
    await store.tree.load();
    await store.loadDir('src');

    expect(mocks.expandDir).toHaveBeenCalledWith('project-1', 'workspace-1', 1);
    expect(store.loadedPaths.has('/repo/src')).toBe(true);
    expect(store.nodes.has('/repo/src/index.ts')).toBe(true);
    expect(store.childrenById.get(1)?.map((entry) => entry.path)).toEqual(['/repo/src/index.ts']);
    store.dispose();
  });

  it('sorts root nodes and loaded child buckets directories first', async () => {
    mocks.getSnapshot.mockResolvedValue(
      snapshot([
        node(1, '/repo/z-file.ts', 'file'),
        node(2, '/repo/components', 'directory'),
        node(3, '/repo/a-file.ts', 'file'),
        node(4, '/repo/alpha', 'directory'),
        node(5, '/repo/components/z.ts', 'file', 2),
        node(6, '/repo/components/a', 'directory', 2),
      ])
    );

    const store = createStore();
    await store.tree.load();

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

  it('updates only the affected children bucket for accepted deltas', async () => {
    mocks.getSnapshot.mockResolvedValue(
      snapshot([
        node(1, '/repo/src', 'directory', null, true),
        node(2, '/repo/README.md', 'file'),
        node(3, '/repo/src/a.ts', 'file', 1),
      ])
    );

    const store = createStore();
    await store.tree.load();

    const rootBefore = store.rootNodes;
    const srcChildrenBefore = store.childrenById.get(1);

    emit?.({
      workspaceId: 'workspace-1',
      update: {
        kind: 'delta',
        generation: 1,
        sequence: 2,
        ops: [{ op: 'put', key: 4, value: node(4, '/repo/src/b.ts', 'file', 1) }],
      },
    });
    await flushAsyncWork();

    expect(store.rootNodes).toBe(rootBefore);
    expect(store.childrenById.get(1)).not.toBe(srcChildrenBefore);
    expect(store.childrenById.get(1)?.map((entry) => entry.path)).toEqual([
      '/repo/src/a.ts',
      '/repo/src/b.ts',
    ]);
    store.dispose();
  });

  it('loads and expands ancestor directories when revealing a file', async () => {
    mocks.getSnapshot.mockResolvedValue(snapshot([node(1, '/repo/src', 'directory')]));
    mocks.revealPath.mockImplementation(async () => {
      emit?.({
        workspaceId: 'workspace-1',
        update: {
          kind: 'delta',
          generation: 1,
          sequence: 2,
          ops: [
            { op: 'put', key: 1, value: node(1, '/repo/src', 'directory', null, true) },
            { op: 'put', key: 2, value: node(2, '/repo/src/a', 'directory', 1, true) },
            { op: 'put', key: 3, value: node(3, '/repo/src/a/b.ts', 'file', 2) },
          ],
        },
      });
      return mutation(2);
    });

    const store = createStore();
    const expandedPaths = new Set<string>();
    await store.tree.load();
    await store.revealFile('src/a/b.ts', expandedPaths);

    expect(mocks.revealPath).toHaveBeenCalledWith('project-1', 'workspace-1', '/repo/src/a/b.ts');
    expect([...expandedPaths]).toEqual(['/repo/src', '/repo/src/a']);
    expect(store.nodes.has('/repo/src/a/b.ts')).toBe(true);
    store.dispose();
  });

  it('adds optimistic nodes under loaded parents and reconciles them by path', async () => {
    mocks.getSnapshot.mockResolvedValue(snapshot([node(1, '/repo/src', 'directory', null, true)]));

    const store = createStore();
    await store.tree.load();

    expect(store.addOptimisticNodes([{ path: 'src/new.ts', type: 'file' }])).toEqual([
      '/repo/src/new.ts',
    ]);
    expect(store.nodes.get('/repo/src/new.ts')?.id).toBeLessThan(0);

    emit?.({
      workspaceId: 'workspace-1',
      update: {
        kind: 'delta',
        generation: 1,
        sequence: 2,
        ops: [{ op: 'put', key: 2, value: node(2, '/repo/src/new.ts', 'file', 1) }],
      },
    });
    await flushAsyncWork();

    expect(store.nodes.get('/repo/src/new.ts')?.id).toBe(2);
    expect(store.childrenById.get(1)?.map((entry) => entry.path)).toEqual(['/repo/src/new.ts']);
    store.dispose();
  });

  it('rolls back optimistic nodes by path', async () => {
    mocks.getSnapshot.mockResolvedValue(snapshot([node(1, '/repo/src', 'directory', null, true)]));

    const store = createStore();
    await store.tree.load();
    store.addOptimisticNodes([{ path: 'src/new.ts', type: 'file' }]);
    store.removeNode('src/new.ts');

    expect(store.nodes.has('/repo/src/new.ts')).toBe(false);
    store.dispose();
  });

  it('expires unreconciled optimistic nodes after a safety timeout', async () => {
    vi.useFakeTimers();
    mocks.getSnapshot.mockResolvedValue(snapshot([node(1, '/repo/src', 'directory', null, true)]));

    const store = createStore();
    await store.tree.load();
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
