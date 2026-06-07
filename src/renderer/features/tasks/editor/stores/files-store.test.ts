import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileWatchEvent } from '@shared/core/fs/fs';
import { FilesStore } from './files-store';

const mocks = vi.hoisted(() => ({
  listFiles: vi.fn(),
  watchSetPaths: vi.fn(),
  watchStop: vi.fn(),
  eventOn: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    workspace: {
      fs: {
        listFiles: mocks.listFiles,
        watchSetPaths: mocks.watchSetPaths,
        watchStop: mocks.watchStop,
      },
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

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('FilesStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.listFiles.mockReset();
    mocks.watchSetPaths.mockReset();
    mocks.watchStop.mockReset();
    mocks.eventOn.mockReset();
    mocks.watchSetPaths.mockResolvedValue({ success: true, data: { supported: true } });
    mocks.watchStop.mockResolvedValue({ success: true, data: {} });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('loads the root directory and warms discovered child directories in the background', async () => {
    setupListFiles({
      '': [
        { path: 'src', type: 'dir' },
        { path: 'README.md', type: 'file' },
      ],
      src: [{ path: 'src/index.ts', type: 'file' }],
    });

    const store = new FilesStore('project-1', 'workspace-1');
    await store.tree.load();
    await flushAsyncWork();
    store.dispose();

    expect(mocks.listFiles).toHaveBeenCalledWith('project-1', 'workspace-1', '.', {
      recursive: false,
      includeHidden: true,
    });
    expect(mocks.listFiles).toHaveBeenCalledWith('project-1', 'workspace-1', 'src', {
      recursive: false,
      includeHidden: true,
    });
    expect(store.loadedPaths.has('')).toBe(true);
    expect(store.loadedPaths.has('src')).toBe(true);
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

  it('sorts loaded directory entries once after applying the batch', async () => {
    setupListFiles({
      '': [
        { path: 'z-file.ts', type: 'file' },
        { path: 'components', type: 'dir' },
        { path: 'a-file.ts', type: 'file' },
        { path: 'alpha', type: 'dir' },
      ],
    });

    const store = new FilesStore('project-1', 'workspace-1');
    await store.tree.load();

    expect(store.rootNodes.map((node) => node.path)).toEqual([
      'alpha',
      'components',
      'a-file.ts',
      'z-file.ts',
    ]);
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

  it('removes stale descendants and loaded markers when a loaded directory becomes a file', async () => {
    const entriesByDir: Record<string, Entry[]> = {
      '': [{ path: 'src', type: 'dir' }],
      src: [{ path: 'src/components', type: 'dir' }],
      'src/components': [{ path: 'src/components/Button.tsx', type: 'file' }],
    };
    setupListFiles(entriesByDir);

    const store = new FilesStore('project-1', 'workspace-1');
    await store.tree.load();
    await flushAsyncWork();

    expect(store.nodes.has('src/components/Button.tsx')).toBe(true);
    expect(store.loadedPaths.has('src/components')).toBe(true);

    entriesByDir.src = [{ path: 'src/components', type: 'file' }];
    await store.loadDir('src', true);
    vi.runOnlyPendingTimers();

    expect(store.nodes.get('src/components')?.type).toBe('file');
    expect(store.nodes.get('src/components')?.children).toEqual([]);
    expect(store.nodes.has('src/components/Button.tsx')).toBe(false);
    expect(store.loadedPaths.has('src/components')).toBe(false);
    expect(store.nodes.get('src')?.children.map((node) => node.path)).toEqual(['src/components']);
    store.dispose();
  });

  it('sorts watch-created siblings after processing the event batch', async () => {
    let emit: ((data: { workspaceId: string; events: FileWatchEvent[] }) => void) | undefined;
    mocks.eventOn.mockImplementation((_channel: string, handler: typeof emit) => {
      emit = handler;
      return vi.fn();
    });
    setupListFiles({ '': [] });

    const store = new FilesStore('project-1', 'workspace-1');
    store.startWatching();
    await store.tree.load();

    emit?.({
      workspaceId: 'workspace-1',
      events: [
        { type: 'create', entryType: 'file', path: 'z-file.ts' },
        { type: 'create', entryType: 'directory', path: 'components' },
        { type: 'create', entryType: 'file', path: 'a-file.ts' },
        { type: 'create', entryType: 'directory', path: 'alpha' },
      ],
    });

    expect(store.rootNodes.map((node) => node.path)).toEqual([
      'alpha',
      'components',
      'a-file.ts',
      'z-file.ts',
    ]);
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
