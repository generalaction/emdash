import { encodeResourceUri } from '@emdash/core/primitives/path/api';
import { listingEntryKey, type FolderListing, type FsError } from '@emdash/core/runtimes/files/api';
import { ok, type Result } from '@emdash/shared';
import { deferred, waitFor } from '@emdash/shared/testing';
import { defineContract } from '@emdash/wire/rpc';
import { cell, expose, type Cell } from '@emdash/wire/state';
import { createTestWire } from '@emdash/wire/testing';
import { observable, runInAction } from 'mobx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { filesWireContract, type FilesListingKey } from '@core/features/files/api';
import type {
  ProjectHostAccess,
  ProjectHostAccessState,
} from '@core/features/projects/api/browser/stores/project-context';
import { hostFileRefFromNativePath } from '@core/primitives/desktop-runtime/api';
import { FilesStore } from './files-store';

const wireClient = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock('@core/features/files/api/browser/client', () => ({
  getFilesClient: async () => wireClient.current,
}));

type Folders = Record<string, FolderListing>;

function ready(entries: Record<string, 'file' | 'directory'>): FolderListing {
  return {
    status: 'ready',
    entries: Object.fromEntries(
      Object.entries(entries).map(([name, kind]) => [listingEntryKey(name), { kind }])
    ),
  };
}

function defaultFolders(): Folders {
  return {
    '': ready({ 'README.md': 'file', src: 'directory' }),
    src: ready({ 'index.ts': 'file' }),
  };
}

function setup(
  options: {
    folders?: Folders;
    sshConnectionId?: string;
    hostAccess?: ProjectHostAccess;
    workspacePath?: string;
    beforeListing?: (path: string) => Promise<void>;
    onRefresh?: (path: string) => Promise<Result<void, FsError> | undefined>;
  } = {}
) {
  const workspacePath = options.workspacePath ?? '/repo';
  const folders = options.folders ?? defaultFolders();
  const cells = new Map<string, Cell<FolderListing>>();
  const listed = (path: string): FolderListing =>
    folders[path] ?? { status: 'error', error: { type: 'not-found', path } };
  const cellFor = (path: string) => {
    let existing = cells.get(path);
    if (!existing) {
      existing = cell(listed(path));
      cells.set(path, existing);
    }
    return existing;
  };
  const listingKeys: FilesListingKey[] = [];
  const refreshes: string[] = [];
  const fsCalls: Array<{ name: string; input: unknown }> = [];

  const provider = expose(
    filesWireContract.listing,
    {
      listing: async (key) => {
        listingKeys.push(key);
        await options.beforeListing?.(key.path);
        return cellFor(key.path);
      },
    },
    {
      mutations: {
        // Like the host: a refresh rereads the folder from "disk".
        refresh: async (context) => {
          refreshes.push(context.key.path);
          const intercepted = await options.onRefresh?.(context.key.path);
          if (intercepted) return intercepted;
          const revision = cellFor(context.key.path).set(listed(context.key.path), {
            mutationIds: [context.mutationId],
          });
          await context.observed('listing', revision);
          return ok(undefined);
        },
      },
      publish: { listing: 'diff' },
    }
  );
  const wire = createTestWire(defineContract({ listing: filesWireContract.listing }), {
    listing: provider,
  });
  const recordFsCall = (name: string) => async (input: unknown) => {
    fsCalls.push({ name, input });
    return ok(undefined);
  };
  wireClient.current = {
    ...wire.client,
    fs: {
      createFile: recordFsCall('createFile'),
      createDirectory: recordFsCall('createDirectory'),
      rename: recordFsCall('rename'),
      move: recordFsCall('move'),
      copy: recordFsCall('copy'),
      delete: recordFsCall('delete'),
    },
  };

  const store = new FilesStore(
    'project-1',
    'workspace-1',
    workspacePath,
    options.sshConnectionId,
    options.hostAccess
  );
  disposeStore = () => store.dispose();
  return { store, folders, cellFor, listingKeys, refreshes, fsCalls };
}

function subscribedPaths(keys: FilesListingKey[]): string[] {
  return [...new Set(keys.map((key) => key.path))].sort();
}

let disposeStore: (() => void) | null = null;

afterEach(() => {
  disposeStore?.();
  disposeStore = null;
  wireClient.current = undefined;
});

describe('FilesStore', () => {
  it('lists the workspace root from its own subscription keyed by the root ResourceUri', async () => {
    const { store, listingKeys } = setup();
    await store.start();

    await waitFor(() => store.rootNodes.length === 2);
    expect(listingKeys[0]).toEqual({
      root: encodeResourceUri(hostFileRefFromNativePath('/repo')),
      path: '',
    });
    expect(store.rootNodes.map((node) => node.path)).toEqual(['/repo/src', '/repo/README.md']);
    expect(store.isLoading).toBe(false);
  });

  it('carries the workspace host into the listing key for remote workspaces', async () => {
    const { store, listingKeys } = setup({ sshConnectionId: 'ssh-1' });
    await store.start();

    await waitFor(() => listingKeys.length > 0);
    expect(listingKeys[0]?.root).toEqual(
      encodeResourceUri(hostFileRefFromNativePath('/repo', 'ssh-1'))
    );
  });

  it('retries a failed initial connection through Refresh', async () => {
    const { store } = setup();
    const client = wireClient.current;
    wireClient.current = {
      get listing() {
        throw new Error('Host is still starting');
      },
    };
    await store.start();
    expect(store.error).toBe('Host is still starting');
    expect(store.isLoading).toBe(false);

    wireClient.current = client;
    await expect(store.refresh()).resolves.toEqual(ok(undefined));
    expect(store.error).toBeUndefined();
    await waitFor(() => store.nodes.has('/repo/README.md'));
  });

  it('subscribes to every open folder whose parents are open, all at once', async () => {
    const gate = deferred<void>();
    const { store, listingKeys } = setup({
      folders: {
        ...defaultFolders(),
        src: ready({ deep: 'directory' }),
        'src/deep': ready({ 'leaf.ts': 'file' }),
      },
      beforeListing: async (path) => {
        if (path === '') await gate.promise;
      },
    });
    store.setExpandedPaths(['/repo/src', '/repo/src/deep', '/repo/hidden/below-collapsed']);
    void store.start();

    // Remembered folders load alongside the root rather than one level at a time.
    await waitFor(() => subscribedPaths(listingKeys).length === 3);
    expect(subscribedPaths(listingKeys)).toEqual(['', 'src', 'src/deep']);
    gate.resolve();
    await waitFor(() => store.nodes.has('/repo/src/deep/leaf.ts'));
  });

  it('opens the lone subfolder of an open folder, as its compacted row shows it', async () => {
    const { store, listingKeys } = setup({
      folders: {
        '': ready({ src: 'directory' }),
        src: ready({ main: 'directory' }),
        'src/main': ready({ java: 'directory', 'README.md': 'file' }),
        'src/main/java': ready({ 'App.java': 'file' }),
      },
    });
    store.setExpandedPaths(['/repo/src']);
    await store.start();

    await waitFor(() => store.nodes.has('/repo/src/main/java'));
    // src/main holds two entries, so the chain stops there and java stays closed.
    expect(subscribedPaths(listingKeys)).toEqual(['', 'src', 'src/main']);
    expect(store.nodes.has('/repo/src/main/java/App.java')).toBe(false);
  });

  it('does not follow a lone folder link into the chain', async () => {
    const { store, listingKeys } = setup({
      folders: {
        '': ready({ src: 'directory' }),
        src: {
          status: 'ready',
          entries: { '/linked': { kind: 'symlink', symlinkTargetKind: 'directory' } },
        },
      },
    });
    store.setExpandedPaths(['/repo/src']);
    await store.start();

    await waitFor(() => store.nodes.has('/repo/src/linked'));
    expect(subscribedPaths(listingKeys)).toEqual(['', 'src']);
  });

  it('drops a remembered folder that its listed parent no longer contains', async () => {
    const { store } = setup();
    store.setExpandedPaths(['/repo/gone']);
    await store.start();

    await waitFor(() => store.rootNodes.length === 2);
    await waitFor(() => !store.directoryErrors.has('/repo/gone'));
    expect(store.loadedPaths.has('/repo/gone')).toBe(false);
  });

  it('releases a folder when it is collapsed', async () => {
    const { store } = setup();
    store.setExpandedPaths(['/repo/src']);
    await store.start();
    await waitFor(() => store.nodes.has('/repo/src/index.ts'));

    store.setExpandedPaths([]);

    await waitFor(() => !store.loadedPaths.has('/repo/src'));
    expect(store.nodes.has('/repo/src/index.ts')).toBe(false);
    expect(store.nodes.has('/repo/src')).toBe(true);
  });

  it('shows a folder that cannot be listed on its row and retries it on the host', async () => {
    const { store, folders, refreshes } = setup({
      folders: {
        ...defaultFolders(),
        src: { status: 'error', error: { type: 'permission-denied', path: 'src' } },
      },
    });
    store.setExpandedPaths(['/repo/src']);
    await store.start();
    await waitFor(() => store.directoryErrors.has('/repo/src'));
    expect(store.directoryErrors.get('/repo/src')).toContain('permission-denied');
    expect(store.error).toBeUndefined();

    folders.src = ready({ 'recovered.ts': 'file' });
    await expect(store.retry('/repo/src')).resolves.toEqual(ok(undefined));

    expect(refreshes).toEqual(['src']);
    await waitFor(() => store.nodes.has('/repo/src/recovered.ts'));
    expect(store.directoryErrors.has('/repo/src')).toBe(false);
  });

  it('refreshes the whole workspace through the root listing', async () => {
    const { store, refreshes } = setup();
    await store.start();
    await waitFor(() => store.rootNodes.length === 2);

    await expect(store.refresh()).resolves.toEqual(ok(undefined));
    expect(refreshes).toEqual(['']);
  });

  it('reveals a file by opening every folder on its way at once', async () => {
    const gate = deferred<void>();
    const { store, listingKeys } = setup({
      folders: {
        '': ready({ a: 'directory' }),
        a: ready({ b: 'directory' }),
        'a/b': ready({ 'c.ts': 'file' }),
      },
      beforeListing: async (path) => {
        if (path === 'a') await gate.promise;
      },
    });
    await store.start();

    const reveal = store.revealFile('/repo/a/b/c.ts');
    await waitFor(() => subscribedPaths(listingKeys).length === 3);
    gate.resolve();

    await expect(reveal).resolves.toEqual(ok(['/repo/a', '/repo/a/b']));
  });

  it('keeps revealed folders listed while the view takes them over as expanded', async () => {
    const { store, listingKeys } = setup({
      folders: { '': ready({ a: 'directory' }), a: ready({ 'b.ts': 'file' }) },
    });
    await store.start();

    const revealed = await store.revealFile('/repo/a/b.ts');
    expect(revealed).toEqual(ok(['/repo/a']));
    expect(store.loadedPaths.has('/repo/a')).toBe(true);
    if (revealed.success) store.setExpandedPaths(revealed.data);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(store.loadedPaths.has('/repo/a')).toBe(true);
    expect(listingKeys.filter((key) => key.path === 'a')).toHaveLength(1);
  });

  it('reports a reveal of a missing file as not found', async () => {
    const { store } = setup();
    await store.start();

    await expect(store.revealFile('/repo/src/missing.ts')).resolves.toMatchObject({
      success: false,
      error: { type: 'not-found', path: 'src/missing.ts' },
    });
  });

  it('cancels a reveal through its signal', async () => {
    const gate = deferred<void>();
    const { store } = setup({
      beforeListing: async (path) => {
        if (path === 'src') await gate.promise;
      },
    });
    await store.start();
    const abort = new AbortController();

    const reveal = store.revealFile('/repo/src/index.ts', { signal: abort.signal });
    abort.abort(new Error('File reveal superseded'));

    await expect(reveal).resolves.toMatchObject({
      success: false,
      error: { type: 'unavailable', message: 'File reveal superseded' },
    });
    gate.resolve();
  });

  it('filters exclusions in the projection without listing anything again', async () => {
    const { store, listingKeys } = setup({
      folders: { '': ready({ '.git': 'directory', node_modules: 'directory', src: 'directory' }) },
    });
    await store.start();
    await waitFor(() => store.rootNodes.length > 0);
    expect(store.rootNodes.map((node) => node.name)).toEqual(['node_modules', 'src']);
    const subscriptions = listingKeys.length;

    store.setExclusions(['node_modules']);

    expect(store.rootNodes.map((node) => node.name)).toEqual(['.git', 'src']);
    expect(store.isTreeExcluded('/repo/node_modules/react/index.js')).toBe(true);
    expect(store.isTreeExcluded('/repo/src/index.ts')).toBe(false);
    expect(listingKeys).toHaveLength(subscriptions);
  });

  it('keeps unchanged folders and nodes by identity across listing updates', async () => {
    const { store, cellFor } = setup({
      folders: {
        ...defaultFolders(),
        '': ready({ 'README.md': 'file', lib: 'directory', src: 'directory' }),
        lib: ready({ 'util.ts': 'file' }),
      },
    });
    store.setExpandedPaths(['/repo/lib', '/repo/src']);
    await store.start();
    await waitFor(
      () => store.nodes.has('/repo/lib/util.ts') && store.nodes.has('/repo/src/index.ts')
    );
    const rootNodes = store.rootNodes;
    const libChildren = store.childrenById.get('lib');
    const indexNode = store.nodes.get('/repo/src/index.ts');

    cellFor('src').update((previous) => ({
      status: 'ready',
      entries: {
        ...(previous.status === 'ready' ? previous.entries : {}),
        '/new.ts': { kind: 'file' },
      },
    }));
    await waitFor(() => store.nodes.has('/repo/src/new.ts'));

    expect(store.rootNodes).toBe(rootNodes);
    expect(store.childrenById.get('lib')).toBe(libChildren);
    expect(store.nodes.get('/repo/src/index.ts')).toBe(indexNode);
  });

  it('shows rows for uploads until the live listing contains them', async () => {
    const { store, cellFor } = setup();
    await store.start();
    await waitFor(() => store.rootNodes.length === 2);

    expect(store.addOptimisticNodes([{ path: '/repo/upload.txt', type: 'file' }])).toEqual([
      '/repo/upload.txt',
    ]);
    expect(store.nodes.get('/repo/upload.txt')?.id).toMatch(/^pending-upload:/);

    cellFor('').update((previous) => ({
      status: 'ready',
      entries: {
        ...(previous.status === 'ready' ? previous.entries : {}),
        '/upload.txt': { kind: 'file' },
      },
    }));
    await waitFor(() => store.nodes.get('/repo/upload.txt')?.id === 'upload.txt');
  });

  it('routes write operations through the stateless fs verbs keyed by ResourceUri', async () => {
    const { store, fsCalls } = setup();
    await store.start();

    await expect(store.createFile('/repo/src/new.ts')).resolves.toEqual(ok(undefined));
    await expect(store.createDirectory('/repo/src/lib')).resolves.toEqual(ok(undefined));
    await expect(store.rename('/repo/README.md', 'README2.md')).resolves.toEqual(ok(undefined));
    await expect(store.move('/repo/README.md', '/repo/src')).resolves.toEqual(ok(undefined));
    await expect(store.deleteEntry('/repo/src/index.ts', true)).resolves.toEqual(ok(undefined));

    const uri = (path: string) => encodeResourceUri(hostFileRefFromNativePath(path));
    const named = (name: string) => fsCalls.filter((call) => call.name === name);
    expect(named('createFile')[0]?.input).toEqual({ uri: uri('/repo/src/new.ts') });
    expect(named('createDirectory')[0]?.input).toEqual({ uri: uri('/repo/src/lib') });
    expect(named('rename')[0]?.input).toEqual({
      from: uri('/repo/README.md'),
      to: uri('/repo/README2.md'),
    });
    expect(named('move')[0]?.input).toEqual({
      from: uri('/repo/README.md'),
      to: uri('/repo/src/README.md'),
    });
    expect(named('delete')[0]?.input).toEqual({
      uri: uri('/repo/src/index.ts'),
      recursive: true,
    });
  });

  it('round-trips a UNC root through listing keys and filesystem mutations', async () => {
    const workspacePath = String.raw`\\server\share\repo`;
    const { store, fsCalls } = setup({ workspacePath });
    await store.start();

    await waitFor(() => store.rootNodes.length === 2);
    expect(store.rootPath).toBe('//server/share/repo');
    expect(store.rootNodes.map((node) => node.path)).toEqual([
      '//server/share/repo/src',
      '//server/share/repo/README.md',
    ]);

    await expect(
      store.rename(String.raw`\\server\share\repo\README.md`, 'README2.md')
    ).resolves.toEqual(ok(undefined));
    expect(fsCalls.find((call) => call.name === 'rename')?.input).toEqual({
      from: encodeResourceUri(hostFileRefFromNativePath(String.raw`\\server\share\repo\README.md`)),
      to: encodeResourceUri(hostFileRefFromNativePath(String.raw`\\server\share\repo\README2.md`)),
    });
  });

  it('retains the observed tree as stale and blocks writes while offline', async () => {
    const state = observable.box<ProjectHostAccessState>({
      kind: 'ready',
      hostGeneration: 1,
    });
    const hostAccess = {
      get state() {
        return state.get();
      },
      get liveAction() {
        const current = state.get();
        return current.kind === 'ready'
          ? ({ kind: 'enabled' } as const)
          : ({ kind: 'disabled', state: current } as const);
      },
    } as ProjectHostAccess;
    const { store, fsCalls } = setup({ hostAccess });
    await store.start();
    await waitFor(() => store.rootNodes.length === 2);
    const subscriptions = (
      store as unknown as {
        subscriptions: Map<
          string,
          { member: { states: { listing: { refresh(): Promise<void> } } } }
        >;
      }
    ).subscriptions;
    const refresh = vi.spyOn(subscriptions.get('')!.member.states.listing, 'refresh');

    runInAction(() => state.set({ kind: 'degraded', situation: 'offline', recovery: 'automatic' }));

    expect(store.observation.kind).toBe('stale');
    expect(store.rootNodes.map((node) => node.path)).toEqual(['/repo/src', '/repo/README.md']);
    await expect(store.createFile('/repo/offline.ts')).resolves.toMatchObject({
      success: false,
      error: { type: 'unavailable' },
    });
    expect(fsCalls).toEqual([]);

    runInAction(() => state.set({ kind: 'ready', hostGeneration: 2 }));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(store.observation.kind).toBe('live');
  });

  it('reports a never-observed offline tree unavailable without contacting Files', async () => {
    const state: ProjectHostAccessState = {
      kind: 'degraded',
      situation: 'offline',
      recovery: 'automatic',
    };
    const hostAccess = {
      state,
      liveAction: { kind: 'disabled', state },
    } as ProjectHostAccess;
    const { store, listingKeys } = setup({ hostAccess });

    await store.start();

    expect(store.observation).toEqual({ kind: 'unavailable' });
    expect(store.isLoading).toBe(false);
    expect(listingKeys).toEqual([]);
  });
});
