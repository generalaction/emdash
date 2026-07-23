import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deferred } from '@emdash/shared/testing';
import { ROOT_RELATIVE_PATH, type PortableRelativePath } from '@primitives/path/api';
import type { FileTreeModel } from '@runtimes/files/api';
import { resolveRootIdentity, treeIdentity } from '@runtimes/files/node/allocation/identity';
import { RootResource } from '@runtimes/files/node/root/root-resource';
import { runtimeRoot } from '@runtimes/files/node/testing/paths';
import type { IWatchService, WatchEvent, WatchOptions } from '@services/fs-watch/api';
import { afterEach, describe, expect, it } from 'vitest';
import { TreeResource } from './tree-resource';

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe('TreeResource', () => {
  it('eagerly expands one child layer when depth is 2', async () => {
    const { rootPath, tree } = await createHarness();
    await mkdir(path.join(rootPath, 'repo', '.git'), { recursive: true });
    await mkdir(path.join(rootPath, 'plain', 'src'), { recursive: true });

    const diagnostic = tree as unknown as DiagnosticTreeResource;
    const result = await diagnostic.expandPath(ROOT_RELATIVE_PATH, undefined, 2);

    expect(result.success).toBe(true);
    const model = diagnostic.current();
    expect(model.entries.repo?.childrenLoaded).toBe(true);
    expect(model.entries.repo?.children).toContain('repo/.git');
    expect(model.entries.plain?.childrenLoaded).toBe(true);
    expect(model.entries.plain?.children).toContain('plain/src');
    expect(model.entries['repo/.git']?.childrenLoaded).toBe(false);
  });

  it('keeps expand shallow when depth is omitted', async () => {
    const { rootPath, tree } = await createHarness();
    await mkdir(path.join(rootPath, 'repo', '.git'), { recursive: true });

    const diagnostic = tree as unknown as DiagnosticTreeResource;
    const result = await diagnostic.expandPath(ROOT_RELATIVE_PATH);

    expect(result.success).toBe(true);
    const model = diagnostic.current();
    expect(model.entries.repo?.childrenLoaded).toBe(false);
    expect(model.entries.repo?.children).toEqual([]);
  });

  it('coalesces a resync burst to one active and one trailing rebuild', async () => {
    const { tree, watcher } = await createHarness();
    const diagnostic = tree as unknown as DiagnosticTreeResource;
    const firstStarted = deferred<void>();
    const resumeFirst = deferred<void>();
    let rebuilds = 0;

    diagnostic.resync = async () => {
      rebuilds += 1;
      if (rebuilds !== 1) return;
      firstStarted.resolve();
      await resumeFirst.promise;
    };

    watcher.resync();
    await firstStarted.promise;
    for (let index = 0; index < 10; index += 1) watcher.resync();

    expect(rebuilds).toBe(1);
    resumeFirst.resolve();
    await diagnostic.lane;

    expect(rebuilds).toBe(2);
  });

  it('drops a trailing resync when disposed during the active rebuild', async () => {
    const { tree, watcher } = await createHarness();
    const diagnostic = tree as unknown as DiagnosticTreeResource;
    const firstStarted = deferred<void>();
    const resumeFirst = deferred<void>();
    let rebuilds = 0;

    diagnostic.resync = async () => {
      rebuilds += 1;
      if (rebuilds !== 1) return;
      firstStarted.resolve();
      await resumeFirst.promise;
    };

    watcher.resync();
    await firstStarted.promise;
    watcher.resync();
    const disposal = tree.dispose();
    resumeFirst.resolve();
    await disposal;

    expect(rebuilds).toBe(1);
  });
});

type DiagnosticTreeResource = {
  lane: Promise<void>;
  current(): FileTreeModel;
  expandPath(
    entryPath: PortableRelativePath,
    mutationId?: string,
    depth?: 1 | 2
  ): Promise<{ success: boolean }>;
  resync(previous: FileTreeModel): Promise<void>;
};

class ManualWatcher implements IWatchService {
  private onResync: (() => void) | undefined;

  watch(_root: string, _onEvents: (events: WatchEvent[]) => void, options: WatchOptions = {}) {
    this.onResync = options.onResync;
    return {
      ready: async () => {},
      release: async () => {
        this.onResync = undefined;
      },
    };
  }

  resync(): void {
    this.onResync?.();
  }

  async dispose(): Promise<void> {
    this.onResync = undefined;
  }
}

async function createHarness(): Promise<{
  rootPath: string;
  tree: TreeResource;
  watcher: ManualWatcher;
}> {
  const rootPath = await realpath(await mkdtemp(path.join(tmpdir(), 'emdash-tree-resource-')));
  cleanups.push(() => rm(rootPath, { recursive: true, force: true }));

  const resolved = await resolveRootIdentity(runtimeRoot(rootPath));
  if (!resolved.success) throw new Error(`Unable to resolve test root: ${resolved.error.type}`);

  const watcher = new ManualWatcher();
  const root = await RootResource.create({ identity: resolved.data, watcher });
  cleanups.push(() => root.dispose());

  const identity = treeIdentity(resolved.data, {
    root: resolved.data.root,
    sessionId: 'tree-resource-test',
  });
  const tree = new TreeResource({ identity, root });
  cleanups.push(() => tree.dispose());
  return { rootPath, tree, watcher };
}
