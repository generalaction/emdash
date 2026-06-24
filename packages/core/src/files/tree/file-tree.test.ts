import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Result } from '@emdash/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { IWatchService, WatchEvent, WatchHandle } from '../../watch';
import { FilesRuntime } from '../files-runtime';
import { resolveInsideRoot } from '../paths';
import { FileTree } from './file-tree';
import type { FileNode } from './models/tree';

class ManualWatchService implements IWatchService {
  private consumers: Array<(events: WatchEvent[]) => void> = [];
  private readyCalls = 0;
  private releaseCalls = 0;

  get watchCount(): number {
    return this.readyCalls;
  }

  get releaseCount(): number {
    return this.releaseCalls;
  }

  watch(_root: string, onEvents: (events: WatchEvent[]) => void): WatchHandle {
    this.consumers.push(onEvents);
    this.readyCalls += 1;
    return {
      ready: async () => {},
      release: async () => {
        this.releaseCalls += 1;
        this.consumers = this.consumers.filter((consumer) => consumer !== onEvents);
      },
    };
  }

  emit(events: WatchEvent[]): void {
    for (const consumer of this.consumers) consumer(events);
  }

  async dispose(): Promise<void> {}
}

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'emdash-file-tree-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('FileTree', () => {
  it('loads only the root scope at startup and expands directories lazily', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'src', 'nested'), { recursive: true });
    await writeFile(path.join(root, 'src', 'nested', 'a.ts'), 'a', 'utf8');
    await writeFile(path.join(root, 'README.md'), 'readme', 'utf8');

    const tree = new FileTree({ rootPath: root, watcher: new ManualWatchService() });
    unwrap(await tree.ready());

    expect(paths(await nodes(tree))).toEqual(['src', 'README.md']);
    const src = nodeByPath(await nodes(tree), 'src');
    expect(src.childrenLoaded).toBe(false);

    await expect(tree.expandDir(src.id)).resolves.toMatchObject({
      success: true,
      data: { tree: expect.any(Number) },
    });

    const expanded = await nodes(tree);
    expect(paths(expanded)).toEqual(['src', 'README.md', 'src/nested']);
    expect(nodeByPath(expanded, 'src').childrenLoaded).toBe(true);
    await tree.dispose();
  });

  it('hard-excludes noisy directories in core', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    await mkdir(path.join(root, '.git'), { recursive: true });
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'node_modules', 'pkg', 'index.js'), 'x', 'utf8');
    await writeFile(path.join(root, 'src', 'index.ts'), 'x', 'utf8');

    const tree = new FileTree({ rootPath: root, watcher: new ManualWatchService() });
    unwrap(await tree.ready());

    expect(paths(await nodes(tree))).toEqual(['src']);
    await tree.dispose();
  });

  it('ignores symlinks consistently in snapshots and watch-created entries', async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, 'target.txt'), 'x', 'utf8');
    const symlinkSupported = await trySymlink('target.txt', path.join(root, 'link.txt'));
    if (!symlinkSupported) return;

    const watcher = new ManualWatchService();
    const tree = new FileTree({ rootPath: root, watcher });
    unwrap(await tree.ready());

    expect(paths(await nodes(tree))).toEqual(['target.txt']);

    const patched = tree as unknown as {
      applyWatchEvents(events: WatchEvent[]): Promise<void>;
    };
    const originalApplyWatchEvents = patched.applyWatchEvents;
    let resolveApplied: () => void = () => {};
    const applied = new Promise<void>((resolve) => {
      resolveApplied = resolve;
    });
    patched.applyWatchEvents = async (events) => {
      try {
        await originalApplyWatchEvents.call(tree, events);
      } finally {
        resolveApplied();
      }
    };

    await symlink('target.txt', path.join(root, 'watch-link.txt'), 'file');
    watcher.emit([{ kind: 'create', path: path.join(root, 'watch-link.txt') }]);
    await applied;

    expect(paths(await nodes(tree))).toEqual(['target.txt']);
    patched.applyWatchEvents = originalApplyWatchEvents;
    tree.dispose();
  });

  it('reveals a nested path by loading each parent scope', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'src', 'a'), { recursive: true });
    await writeFile(path.join(root, 'src', 'a', 'file.ts'), 'x', 'utf8');

    const tree = new FileTree({ rootPath: root, watcher: new ManualWatchService() });
    unwrap(await tree.ready());

    await expect(tree.revealPath('src/a/file.ts')).resolves.toMatchObject({
      success: true,
      data: { tree: expect.any(Number) },
    });

    expect(paths(await nodes(tree))).toEqual(['src', 'src/a', 'src/a/file.ts']);
    await tree.dispose();
  });

  it('returns not-found when revealPath cannot find a loaded path component', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'src'), { recursive: true });

    const tree = new FileTree({ rootPath: root, watcher: new ManualWatchService() });
    unwrap(await tree.ready());

    await expect(tree.revealPath('src/missing/file.ts')).resolves.toMatchObject({
      success: false,
      error: { type: 'not-found', path: 'src/missing' },
    });
    await tree.dispose();
  });

  it('does not cache a rejected ready promise after unexpected load failures', async () => {
    const root = await makeRoot();
    const tree = new FileTree({ rootPath: root, watcher: new ManualWatchService() });
    const patched = tree as unknown as {
      loadDirectoryScope(scope: null): Promise<Result<unknown, unknown>>;
    };
    const originalLoadDirectoryScope = patched.loadDirectoryScope;
    let calls = 0;
    patched.loadDirectoryScope = async () => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return { success: true, data: {} };
    };

    try {
      await expect(tree.ready()).rejects.toThrow('boom');
      await expect(tree.ready()).resolves.toEqual({ success: true, data: undefined });
      expect(calls).toBe(2);
    } finally {
      patched.loadDirectoryScope = originalLoadDirectoryScope;
      await tree.dispose();
    }
  });

  it('rejects unsafe paths before filesystem access', async () => {
    const root = await makeRoot();
    expect(resolveInsideRoot(root, '../outside').success).toBe(false);
    expect(resolveInsideRoot(root, path.join(root, 'absolute')).success).toBe(false);
  });

  it('reuses a node id for a delete/create rename batch with matching inode', async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, 'a.txt'), 'x', 'utf8');
    const watcher = new ManualWatchService();
    const tree = new FileTree({ rootPath: root, watcher });
    unwrap(await tree.ready());
    const before = nodeByPath(await nodes(tree), 'a.txt');

    await rename(path.join(root, 'a.txt'), path.join(root, 'b.txt'));
    watcher.emit([
      { kind: 'delete', path: path.join(root, 'a.txt') },
      { kind: 'create', path: path.join(root, 'b.txt') },
    ]);
    await waitForNode(tree, 'b.txt');

    const after = await nodes(tree);
    expect(nodeByPath(after, 'b.txt').id).toBe(before.id);
    expect(after.some((node) => node.path === 'a.txt')).toBe(false);
    await tree.dispose();
  });

  it('reuses directory and descendant ids when a loaded directory is renamed', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'src', 'nested'), { recursive: true });
    await writeFile(path.join(root, 'src', 'nested', 'a.ts'), 'x', 'utf8');
    const watcher = new ManualWatchService();
    const tree = new FileTree({ rootPath: root, watcher });
    unwrap(await tree.ready());
    unwrap(await tree.revealPath('src/nested/a.ts'));
    const before = await nodes(tree);
    const src = nodeByPath(before, 'src');
    const nested = nodeByPath(before, 'src/nested');
    const file = nodeByPath(before, 'src/nested/a.ts');

    await rename(path.join(root, 'src'), path.join(root, 'lib'));
    watcher.emit([
      { kind: 'delete', path: path.join(root, 'src') },
      { kind: 'create', path: path.join(root, 'lib') },
    ]);
    await waitForNode(tree, 'lib/nested/a.ts');

    const after = await nodes(tree);
    expect(new Set(paths(after))).toEqual(new Set(['lib', 'lib/nested', 'lib/nested/a.ts']));
    expect(nodeByPath(after, 'lib').id).toBe(src.id);
    expect(nodeByPath(after, 'lib/nested').id).toBe(nested.id);
    expect(nodeByPath(after, 'lib/nested/a.ts').id).toBe(file.id);
    await tree.dispose();
  });

  it('cascades loaded descendants when a directory disappears', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'src', 'nested'), { recursive: true });
    await writeFile(path.join(root, 'src', 'nested', 'a.ts'), 'x', 'utf8');
    const watcher = new ManualWatchService();
    const tree = new FileTree({ rootPath: root, watcher });
    unwrap(await tree.ready());
    await tree.revealPath('src/nested/a.ts');
    expect(paths(await nodes(tree))).toEqual(['src', 'src/nested', 'src/nested/a.ts']);

    await rm(path.join(root, 'src'), { recursive: true });
    watcher.emit([{ kind: 'delete', path: path.join(root, 'src') }]);
    await waitForPaths(tree, []);

    expect(paths(await nodes(tree))).toEqual([]);
    await tree.dispose();
  });

  it('cascades loaded descendants during refresh when a directory disappeared', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'src', 'nested'), { recursive: true });
    await writeFile(path.join(root, 'src', 'nested', 'a.ts'), 'x', 'utf8');
    const tree = new FileTree({ rootPath: root, watcher: new ManualWatchService() });
    unwrap(await tree.ready());
    unwrap(await tree.revealPath('src/nested/a.ts'));
    expect(paths(await nodes(tree))).toEqual(['src', 'src/nested', 'src/nested/a.ts']);

    await rm(path.join(root, 'src'), { recursive: true });
    unwrap(await tree.refresh());

    expect(paths(await nodes(tree))).toEqual([]);
    await tree.dispose();
  });

  it('serializes refreshes and watch event mutations', async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, 'a.txt'), 'x', 'utf8');
    const watcher = new ManualWatchService();
    const tree = new FileTree({ rootPath: root, watcher });
    unwrap(await tree.ready());

    const patched = tree as unknown as {
      refreshLoadedScopes(): Promise<Result<unknown, unknown>>;
      applyWatchEvents(events: WatchEvent[]): Promise<void>;
    };
    const originalRefreshLoadedScopes = patched.refreshLoadedScopes;
    const originalApplyWatchEvents = patched.applyWatchEvents;

    let activeMutations = 0;
    let maxActiveMutations = 0;
    const enterMutation = () => {
      activeMutations += 1;
      maxActiveMutations = Math.max(maxActiveMutations, activeMutations);
    };
    const exitMutation = () => {
      activeMutations -= 1;
    };

    let releaseRefresh: () => void = () => {};
    const refreshEntered = new Promise<void>((resolve) => {
      patched.refreshLoadedScopes = async () => {
        enterMutation();
        resolve();
        await new Promise<void>((release) => {
          releaseRefresh = release;
        });
        try {
          return await originalRefreshLoadedScopes.call(tree);
        } finally {
          exitMutation();
        }
      };
    });

    let resolveWatchApplied: () => void = () => {};
    const watchApplied = new Promise<void>((resolve) => {
      resolveWatchApplied = resolve;
    });
    patched.applyWatchEvents = async (events) => {
      enterMutation();
      try {
        await originalApplyWatchEvents.call(tree, events);
      } finally {
        exitMutation();
        resolveWatchApplied();
      }
    };

    const refresh = tree.refresh();
    await refreshEntered;

    await writeFile(path.join(root, 'created.txt'), 'x', 'utf8');
    watcher.emit([{ kind: 'create', path: path.join(root, 'created.txt') }]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(maxActiveMutations).toBe(1);

    releaseRefresh();
    await refresh;
    await watchApplied;

    expect(maxActiveMutations).toBe(1);
    patched.refreshLoadedScopes = originalRefreshLoadedScopes;
    patched.applyWatchEvents = originalApplyWatchEvents;
    tree.dispose();
  });

  it('runtime leases share one tree per resolved root', async () => {
    const root = await makeRoot();
    const watcher = new ManualWatchService();
    const runtime = new FilesRuntime({ watcher });

    const first = await runtime.openTree(root);
    const second = await runtime.openTree(root);
    const firstLease = unwrap(first);
    const secondLease = unwrap(second);

    expect(firstLease.value).toBe(secondLease.value);
    expect(watcher.watchCount).toBe(1);

    await firstLease.release();
    await secondLease.release();
    await runtime.dispose();
  });

  it('returns a typed error when opening a missing root', async () => {
    const root = path.join(await makeRoot(), 'missing');
    const runtime = new FilesRuntime({ watcher: new ManualWatchService() });

    await expect(runtime.openTree(root)).resolves.toMatchObject({
      success: false,
      error: { type: 'not-found', path: '' },
    });
    await runtime.dispose();
  });

  it('releases the runtime lease when ready rejects unexpectedly', async () => {
    const root = await makeRoot();
    const watcher = new ManualWatchService();
    const runtime = new FilesRuntime({ watcher });
    const originalReady = FileTree.prototype.ready;
    FileTree.prototype.ready = async () => {
      throw new Error('boom');
    };

    try {
      await expect(runtime.openTree(root)).rejects.toThrow('boom');
      await waitFor(async () => watcher.releaseCount === 1);
    } finally {
      FileTree.prototype.ready = originalReady;
      await runtime.dispose();
    }
  });
});

async function nodes(tree: FileTree): Promise<FileNode[]> {
  return unwrap(await tree.getSnapshot()).entries.map(([, node]) => node);
}

function paths(nodes: FileNode[]): string[] {
  return nodes.map((node) => node.path);
}

function nodeByPath(nodes: FileNode[], path: string): FileNode {
  const node = nodes.find((candidate) => candidate.path === path);
  if (!node) throw new Error(`Missing node ${path}`);
  return node;
}

async function waitForNode(tree: FileTree, path: string): Promise<void> {
  await waitFor(async () => (await nodes(tree)).some((node) => node.path === path));
}

async function waitForPaths(tree: FileTree, expected: string[]): Promise<void> {
  await waitFor(async () => {
    expect(paths(await nodes(tree))).toEqual(expected);
    return true;
  });
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (lastError) throw lastError;
  throw new Error('Timed out waiting for file tree condition');
}

async function trySymlink(target: string, linkPath: string): Promise<boolean> {
  try {
    await symlink(target, linkPath, 'file');
    return true;
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    if (code === 'EPERM' || code === 'EACCES') return false;
    throw error;
  }
}

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.success) throw new Error(`Expected ok result: ${JSON.stringify(result.error)}`);
  return result.data;
}
