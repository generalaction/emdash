import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilesStore } from './files-store';

const mocks = vi.hoisted(() => ({
  listFiles: vi.fn(),
  watchSetPaths: vi.fn(),
  watchStop: vi.fn(),
  eventOn: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    fs: {
      listFiles: mocks.listFiles,
      watchSetPaths: mocks.watchSetPaths,
      watchStop: mocks.watchStop,
    },
  },
  events: {
    on: mocks.eventOn,
  },
}));

type Entry = {
  path: string;
  type: 'file' | 'dir';
};

function okEntries(entries: Entry[]) {
  return {
    success: true as const,
    data: {
      entries,
      total: entries.length,
    },
  };
}

function setupListFiles(entriesByDir: Record<string, Entry[]>): void {
  mocks.listFiles.mockImplementation(
    async (_projectId: string, _workspaceId: string, dirPath: string) => {
      const key = dirPath === '.' ? '' : dirPath;
      return okEntries(entriesByDir[key] ?? []);
    }
  );
}

describe('FilesStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.listFiles.mockReset();
    mocks.watchSetPaths.mockReset();
    mocks.watchStop.mockReset();
    mocks.eventOn.mockReset();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('loads only the root directory on initial load', async () => {
    setupListFiles({
      '': [
        { path: 'src', type: 'dir' },
        { path: 'README.md', type: 'file' },
      ],
      src: [{ path: 'src/index.ts', type: 'file' }],
    });

    const store = new FilesStore('project-1', 'workspace-1');
    await store.tree.load();
    store.dispose();

    expect(mocks.listFiles).toHaveBeenCalledTimes(1);
    expect(mocks.listFiles).toHaveBeenCalledWith('project-1', 'workspace-1', '.', {
      recursive: false,
      includeHidden: true,
    });
    expect(store.loadedPaths.has('')).toBe(true);
    expect(store.loadedPaths.has('src')).toBe(false);
    expect(store.rootNodes.map((node) => node.path)).toEqual(['src', 'README.md']);
  });

  it('loads a child directory on demand', async () => {
    setupListFiles({
      '': [{ path: 'src', type: 'dir' }],
      src: [{ path: 'src/index.ts', type: 'file' }],
    });

    const store = new FilesStore('project-1', 'workspace-1');
    await store.tree.load();
    await store.loadDir('src');
    vi.runOnlyPendingTimers();

    expect(mocks.listFiles).toHaveBeenCalledWith('project-1', 'workspace-1', 'src', {
      recursive: false,
      includeHidden: true,
    });
    expect(store.loadedPaths.has('src')).toBe(true);
    expect(store.nodes.has('src/index.ts')).toBe(true);
    expect(store.nodes.get('src')?.children.map((node) => node.path)).toEqual(['src/index.ts']);
    store.dispose();
  });

  it('normalizes loaded child paths into the current folder children', async () => {
    setupListFiles({
      '': [{ path: 'src', type: 'dir' }],
      src: [
        { path: 'src\\components', type: 'dir' },
        { path: 'src\\index.ts', type: 'file' },
      ],
    });

    const store = new FilesStore('project-1', 'workspace-1');
    await store.tree.load();
    await store.loadDir('src');
    vi.runOnlyPendingTimers();

    expect(store.rootNodes.map((node) => node.path)).toEqual(['src']);
    expect(store.nodes.get('src')?.children.map((node) => node.path)).toEqual([
      'src/components',
      'src/index.ts',
    ]);
    expect(store.nodes.has('src\\components')).toBe(false);
    store.dispose();
  });

  it('loads and expands ancestor directories when revealing a file', async () => {
    setupListFiles({
      '': [{ path: 'src', type: 'dir' }],
      src: [{ path: 'src/a', type: 'dir' }],
      'src/a': [{ path: 'src/a/b.ts', type: 'file' }],
    });

    const store = new FilesStore('project-1', 'workspace-1');
    const expandedPaths = new Set<string>();

    await store.tree.load();
    await store.revealFile('src/a/b.ts', expandedPaths);

    expect(mocks.listFiles).toHaveBeenCalledWith('project-1', 'workspace-1', 'src', {
      recursive: false,
      includeHidden: true,
    });
    expect(mocks.listFiles).toHaveBeenCalledWith('project-1', 'workspace-1', 'src/a', {
      recursive: false,
      includeHidden: true,
    });
    expect([...expandedPaths]).toEqual(['src', 'src/a']);
    expect(store.nodes.has('src/a/b.ts')).toBe(true);
    store.dispose();
  });
});
