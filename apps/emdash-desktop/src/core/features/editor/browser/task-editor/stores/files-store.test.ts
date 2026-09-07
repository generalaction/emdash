import {
  canonicalExclusionPatterns,
  DEFAULT_TREE_EXCLUDE,
} from '@emdash/core/primitives/exclusion-policy/api';
import { encodeResourceUri } from '@emdash/core/primitives/path/api';
import type { FileTreeModel, FsError } from '@emdash/core/runtimes/files/api';
import { ok, type Result } from '@emdash/shared';
import { deferred, waitFor } from '@emdash/shared/testing';
import { defineContract } from '@emdash/wire/rpc';
import { cell, expose } from '@emdash/wire/state';
import { createTestWire } from '@emdash/wire/testing';
import { observable, runInAction } from 'mobx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { filesWireContract, type FilesTreeKey } from '@core/features/files/api';
import type {
  ProjectHostAccess,
  ProjectHostAccessState,
} from '@core/features/projects/api/browser/stores/project-context';
import {
  hostFileRefFromNativePath,
  hostPathFromNative,
  portablePath,
} from '@core/primitives/desktop-runtime/api';
import { FilesStore } from './files-store';

const wireClient = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock('@core/features/files/api/browser/client', () => ({
  getFilesClient: async () => wireClient.current,
}));

vi.mock('@core/features/settings/api/browser/app-settings-client', () => ({
  fetchAppSettingsMeta: async () => undefined,
}));

type RecordedMutation = { name: string; key: FilesTreeKey; input: unknown };

function expandedMutationPaths(calls: RecordedMutation[]): string[] {
  return calls.flatMap((call) => {
    if (call.name !== 'expand' || call.input === undefined) return [];
    const path = (call.input as { path: string }).path;
    return path === '' ? [] : [path];
  });
}

function treeMutationOrder(calls: RecordedMutation[]): string[] {
  return calls.flatMap((call) => {
    if ((call.name !== 'expand' && call.name !== 'reveal') || call.input === undefined) return [];
    const path = (call.input as { path: string }).path;
    return path === '' ? [] : [`${call.name}:${path}`];
  });
}

function makeEntry(
  path: string,
  kind: 'file' | 'directory',
  children: readonly string[] = [],
  childrenLoaded = kind === 'directory'
): FileTreeModel['entries'][string] {
  return {
    path: portablePath(path),
    name: path.split('/').pop() ?? '',
    parentPath:
      path === '' ? null : portablePath(path.slice(0, Math.max(path.lastIndexOf('/'), 0))),
    kind,
    childrenLoaded,
    children: children.map((child) => portablePath(child)),
  };
}

function makeTreeModel(root: string): FileTreeModel {
  return {
    root: hostPathFromNative(root),
    entries: {
      '': makeEntry('', 'directory', ['README.md', 'src']),
      'README.md': makeEntry('README.md', 'file'),
      src: makeEntry('src', 'directory', ['src/index.ts']),
      'src/index.ts': makeEntry('src/index.ts', 'file'),
    },
  };
}

function setup(
  options: {
    sshConnectionId?: string;
    hostAccess?: ProjectHostAccess;
    tree?: FileTreeModel;
    workspacePath?: string;
    beforeMutation?: (name: string, input: unknown) => Promise<Result<void, FsError> | undefined>;
  } = {}
) {
  const workspacePath = options.workspacePath ?? '/repo';
  const treeCell = cell<FileTreeModel>(options.tree ?? makeTreeModel(workspacePath));
  const stateKeys: FilesTreeKey[] = [];
  const mutationCalls: RecordedMutation[] = [];
  const fsCalls: Array<{ name: string; input: unknown }> = [];

  const touch = async (
    name: string,
    context: {
      key: FilesTreeKey;
      input?: unknown;
      mutationId: string;
      observed(state: 'tree', revision: ReturnType<typeof treeCell.update>): Promise<void>;
    }
  ) => {
    mutationCalls.push({ name, key: context.key, input: context.input });
    const intercepted = await options.beforeMutation?.(name, context.input);
    if (intercepted) return intercepted;
    const revision = treeCell.update((previous) => ({ ...previous }), {
      mutationIds: [context.mutationId],
    });
    await context.observed('tree', revision);
    return ok(undefined);
  };

  const provider = expose(
    filesWireContract.tree.model,
    {
      tree: (key) => {
        stateKeys.push(key);
        return treeCell;
      },
    },
    {
      mutations: {
        expand: (context) => touch('expand', context),
        reveal: (context) => touch('reveal', context),
        refresh: (context) => touch('refresh', context),
      },
    }
  );

  const testContract = defineContract({ tree: filesWireContract.tree });
  const wire = createTestWire(testContract, { tree: { model: provider } });
  const recordFsCall = (name: string) => async (input: unknown) => {
    fsCalls.push({ name, input });
    return ok(undefined);
  };
  // The write verbs are stateless fs procedures; the tree updates arrive
  // through the live model after the runtime's ack-time republish.
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
  return { store, stateKeys, mutationCalls, fsCalls };
}

let disposeStore: (() => void) | null = null;

afterEach(() => {
  disposeStore?.();
  disposeStore = null;
  wireClient.current = undefined;
});

describe('FilesStore', () => {
  it('binds the files domain tree model without re-expanding a populated root', async () => {
    const { store, stateKeys, mutationCalls } = setup();
    disposeStore = () => store.dispose();

    await store.start();

    expect(stateKeys[0]).toEqual({
      root: encodeResourceUri(hostFileRefFromNativePath('/repo')),
      sessionId: 'workspace-1',
      exclusions: canonicalExclusionPatterns(DEFAULT_TREE_EXCLUDE),
    });
    expect(mutationCalls).not.toContainEqual({
      name: 'expand',
      key: stateKeys[0],
      input: { path: '' },
    });

    await waitFor(() => store.rootNodes.length === 2);
    expect(store.rootNodes.map((node) => node.path)).toEqual(['/repo/src', '/repo/README.md']);
    expect(store.isLoading).toBe(false);
  });

  it('carries the workspace host into the tree key for remote workspaces', async () => {
    const { store, stateKeys } = setup({ sshConnectionId: 'ssh-1' });
    disposeStore = () => store.dispose();

    await store.start();

    expect(stateKeys[0]?.root).toEqual(
      encodeResourceUri(hostFileRefFromNativePath('/repo', 'ssh-1'))
    );
  });

  it('routes write operations through the stateless fs verbs keyed by ResourceUri', async () => {
    const { store, fsCalls } = setup();
    disposeStore = () => store.dispose();
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

  it('round-trips a UNC root through tree identities and filesystem mutations', async () => {
    const workspacePath = String.raw`\\server\share\repo`;
    const { store, fsCalls } = setup({ workspacePath });
    disposeStore = () => store.dispose();
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

  it('reveals files through the tree model and reports ancestor directories', async () => {
    const { store, mutationCalls } = setup();
    disposeStore = () => store.dispose();
    await store.start();

    await expect(store.revealFile('/repo/src/index.ts')).resolves.toEqual(ok(['/repo/src']));
    expect(mutationCalls.filter((call) => call.name === 'reveal')[0]?.input).toEqual({
      path: 'src/index.ts',
    });
  });

  it('cancels a superseded reveal through the Wire mutation signal', async () => {
    const revealGate = deferred<void>();
    const { store, mutationCalls } = setup({
      beforeMutation: async (name) => {
        if (name === 'reveal') await revealGate.promise;
      },
    });
    disposeStore = () => store.dispose();
    await store.start();
    const abort = new AbortController();

    const reveal = store.revealFile('/repo/src/index.ts', { signal: abort.signal });
    await vi.waitFor(() =>
      expect(mutationCalls).toContainEqual(
        expect.objectContaining({ name: 'reveal', input: { path: 'src/index.ts' } })
      )
    );
    abort.abort(new Error('File reveal superseded'));

    await expect(reveal).resolves.toMatchObject({
      success: false,
      error: { type: 'unavailable' },
    });
    revealGate.resolve();
  });

  it('attaches the Replica before background root hydration settles', async () => {
    const rootGate = deferred<void>();
    const tree = makeTreeModel('/repo');
    tree.entries = { '': makeEntry('', 'directory', [], false) };
    const { store, mutationCalls } = setup({
      tree,
      beforeMutation: async (name, input) => {
        if (name === 'expand' && (input as { path: string }).path === '') {
          await rootGate.promise;
        }
        return undefined;
      },
    });
    disposeStore = () => store.dispose();

    await expect(store.start()).resolves.toBeUndefined();
    await vi.waitFor(() =>
      expect(mutationCalls).toContainEqual(
        expect.objectContaining({ name: 'expand', input: { path: '' } })
      )
    );
    expect(store.error).toBeUndefined();
    expect(store.isLoading).toBe(true);

    rootGate.resolve();
    await vi.waitFor(() => expect(store.pendingPaths.size).toBe(0));
  });

  it('hydrates restored directories serially and prioritizes a foreground request', async () => {
    const gates: Array<ReturnType<typeof deferred<void>>> = [];
    const tree = makeTreeModel('/repo');
    tree.entries = {
      '': makeEntry('', 'directory', ['a', 'b', 'c']),
      a: makeEntry('a', 'directory', [], false),
      b: makeEntry('b', 'directory', [], false),
      c: makeEntry('c', 'directory', [], false),
    };
    const { store, mutationCalls } = setup({
      tree,
      beforeMutation: async (name, input) => {
        if (name !== 'expand' || (input as { path: string }).path === '') return;
        const gate = deferred<void>();
        gates.push(gate);
        await gate.promise;
      },
    });
    disposeStore = () => store.dispose();
    await store.start();

    store.reconcileVisibleScopes(new Set(['/repo/a', '/repo/b']));
    await vi.waitFor(() => expect(expandedMutationPaths(mutationCalls)).toEqual(['a']));

    const foreground = store.registerDir('/repo/c');
    gates[0]?.resolve();
    await vi.waitFor(() => expect(expandedMutationPaths(mutationCalls)).toEqual(['a', 'c']));
    gates[1]?.resolve();
    await expect(foreground).resolves.toEqual(ok(undefined));
    await vi.waitFor(() => expect(expandedMutationPaths(mutationCalls)).toEqual(['a', 'c', 'b']));
    gates[2]?.resolve();
    await vi.waitFor(() => expect(store.pendingPaths.size).toBe(0));
  });

  it('prioritizes a foreground reveal over queued restored directories', async () => {
    const gates: Array<ReturnType<typeof deferred<void>>> = [];
    const tree = makeTreeModel('/repo');
    tree.entries = {
      '': makeEntry('', 'directory', ['a', 'b', 'c']),
      a: makeEntry('a', 'directory', [], false),
      b: makeEntry('b', 'directory', [], false),
      c: makeEntry('c', 'directory', ['c/file.ts']),
      'c/file.ts': makeEntry('c/file.ts', 'file'),
    };
    const { store, mutationCalls } = setup({
      tree,
      beforeMutation: async (name, input) => {
        if (name !== 'expand' || (input as { path: string }).path === '') return;
        const gate = deferred<void>();
        gates.push(gate);
        await gate.promise;
      },
    });
    disposeStore = () => store.dispose();
    await store.start();

    store.reconcileVisibleScopes(new Set(['/repo/a', '/repo/b']));
    await vi.waitFor(() => expect(treeMutationOrder(mutationCalls)).toEqual(['expand:a']));
    const reveal = store.revealFile('/repo/c/file.ts');

    gates[0]?.resolve();
    await expect(reveal).resolves.toEqual(ok(['/repo/c']));
    await vi.waitFor(() =>
      expect(treeMutationOrder(mutationCalls).slice(0, 3)).toEqual([
        'expand:a',
        'reveal:c/file.ts',
        'expand:b',
      ])
    );
    gates[1]?.resolve();
    await vi.waitFor(() => expect(store.pendingPaths.size).toBe(0));
  });

  it('runs a trailing forced load when a normal load is already active', async () => {
    const gates: Array<ReturnType<typeof deferred<void>>> = [];
    const tree = makeTreeModel('/repo');
    tree.entries = {
      '': makeEntry('', 'directory', ['src']),
      src: makeEntry('src', 'directory', [], false),
    };
    const { store, mutationCalls } = setup({
      tree,
      beforeMutation: async (name, input) => {
        if (name !== 'expand' || (input as { path: string }).path !== 'src') return;
        const gate = deferred<void>();
        gates.push(gate);
        await gate.promise;
      },
    });
    disposeStore = () => store.dispose();
    await store.start();
    const refresh = vi
      .spyOn(
        (
          store as unknown as {
            treeModel: { states: { tree: { refresh(): Promise<void> } } };
          }
        ).treeModel.states.tree,
        'refresh'
      )
      .mockResolvedValue();

    const normal = store.registerDir('/repo/src');
    await vi.waitFor(() => expect(expandedMutationPaths(mutationCalls)).toEqual(['src']));
    const forced = store.registerDir('/repo/src', true);

    gates[0]?.resolve();
    await expect(normal).resolves.toEqual(ok(undefined));
    await vi.waitFor(() => expect(expandedMutationPaths(mutationCalls)).toEqual(['src', 'src']));
    gates[1]?.resolve();
    await expect(forced).resolves.toEqual(ok(undefined));
    expect(refresh).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(store.pendingPaths.size).toBe(0));
  });

  it('runs a trailing forced load when a forced load is already active', async () => {
    const tree = makeTreeModel('/repo');
    tree.entries = {
      '': makeEntry('', 'directory', ['src']),
      src: makeEntry('src', 'directory', [], false),
    };
    const { store, mutationCalls } = setup({ tree });
    disposeStore = () => store.dispose();
    await store.start();
    const firstRefresh = deferred<void>();
    const refresh = vi
      .spyOn(
        (
          store as unknown as {
            treeModel: { states: { tree: { refresh(): Promise<void> } } };
          }
        ).treeModel.states.tree,
        'refresh'
      )
      .mockImplementationOnce(() => firstRefresh.promise)
      .mockResolvedValue();

    const first = store.registerDir('/repo/src', true);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    const second = store.registerDir('/repo/src', true);
    firstRefresh.resolve();

    await expect(Promise.all([first, second])).resolves.toEqual([ok(undefined), ok(undefined)]);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(expandedMutationPaths(mutationCalls)).toEqual(['src', 'src']);
    expect(store.pendingPaths.size).toBe(0);
  });

  it('settles a queued directory load when the tree Runtime is disposed', async () => {
    const gate = deferred<void>();
    const tree = makeTreeModel('/repo');
    tree.entries = {
      '': makeEntry('', 'directory', ['src']),
      src: makeEntry('src', 'directory', [], false),
    };
    const { store, mutationCalls } = setup({
      tree,
      beforeMutation: async (name, input) => {
        if (name === 'expand' && (input as { path: string }).path === 'src') {
          await gate.promise;
        }
      },
    });
    await store.start();

    const load = store.registerDir('/repo/src');
    await vi.waitFor(() => expect(expandedMutationPaths(mutationCalls)).toEqual(['src']));
    store.dispose();

    await expect(load).resolves.toMatchObject({
      success: false,
      error: { type: 'unavailable', message: 'File tree is unavailable' },
    });
    gate.resolve();
  });

  it('keeps a directory-load failure scoped to the requested path', async () => {
    const tree = makeTreeModel('/repo');
    tree.entries.src = makeEntry('src', 'directory', [], false);
    const { store } = setup({
      tree,
      beforeMutation: async (name, input) => {
        if (name === 'expand' && (input as { path: string }).path === 'src') {
          return {
            success: false,
            error: {
              type: 'io',
              path: 'src',
              message: "Wire call 'files.tree.model.expand' timed out after 30000ms",
            },
          };
        }
        return undefined;
      },
    });
    disposeStore = () => store.dispose();
    await store.start();

    await expect(store.registerDir('/repo/src')).resolves.toMatchObject({
      success: false,
      error: {
        type: 'io',
        path: 'src',
        message: "Wire call 'files.tree.model.expand' timed out after 30000ms",
      },
    });
    expect(store.error).toBeUndefined();
    expect(store.rootNodes.map((node) => node.path)).toEqual(['/repo/src', '/repo/README.md']);
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
    disposeStore = () => store.dispose();
    await store.start();
    await waitFor(() => store.rootNodes.length === 2);
    const refresh = vi.spyOn(
      (
        store as unknown as {
          treeModel: { states: { tree: { refresh(): Promise<void> } } };
        }
      ).treeModel.states.tree,
      'refresh'
    );

    runInAction(() =>
      state.set({
        kind: 'degraded',
        situation: 'offline',
        recovery: 'automatic',
      })
    );

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
    expect(store.rootNodes.map((node) => node.path)).toEqual(['/repo/src', '/repo/README.md']);
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
    const { store, stateKeys } = setup({ hostAccess });
    disposeStore = () => store.dispose();

    await store.start();

    expect(store.observation).toEqual({ kind: 'unavailable' });
    expect(store.isLoading).toBe(false);
    expect(stateKeys).toEqual([]);
  });
});
