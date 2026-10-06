import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { filesContract } from '@emdash/core/runtimes/files/api';
import { createFilesController, FilesRuntime } from '@emdash/core/runtimes/files/node';
import type { IWatchService, WatchEvent, WatchOptions } from '@emdash/core/services/fs-watch/api';
import type { HostRuntimesClient } from '@emdash/core/services/runtime-broker/api';
import { ok } from '@emdash/shared';
import { createTestWire } from '@emdash/wire/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilesStore } from '@core/features/editor/browser/task-editor/stores/files-store';
import { filesWireContract } from '@core/features/files/api';
import { createFilesWireController } from '@core/features/files/node/wire-controller';

const wireClient = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@core/features/files/api/browser/client', () => ({
  getFilesClient: async () => wireClient.current,
}));

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  wireClient.current = undefined;
});

// This exercises both production controllers, both Wire hops, the state bridge,
// the renderer store and real disk I/O. Only host lookup and OS event timing are
// controlled. The remote case tests URI routing, not an actual SSH connection.
describe.each([undefined, 'test-remote'])('file tree end to end (host=%s)', (sshConnectionId) => {
  async function setup(nativeWatcher = false) {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), 'emdash-tree-e2e-')));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await mkdir(path.join(root, 'src/deep'), { recursive: true });
    await mkdir(path.join(root, 'dest'));
    await writeFile(path.join(root, 'README.md'), 'readme');
    await writeFile(path.join(root, 'src/deep/file.ts'), 'original');
    const watcher = new ManualWatcher();
    const runtime = new FilesRuntime(nativeWatcher ? {} : { watcher });
    const upstream = createTestWire(filesContract, createFilesController(runtime));
    const desktop = createTestWire(
      filesWireContract,
      createFilesWireController({
        runtimes: {
          client: async () => ok({ files: upstream.client } as HostRuntimesClient),
        },
      })
    );
    wireClient.current = desktop.client;
    const store = new FilesStore('project', 'tree-e2e', root, sshConnectionId);
    cleanups.push(async () => {
      store.dispose();
      await desktop.dispose();
      await upstream.dispose();
      await runtime.dispose();
    });
    await store.start();
    await vi.waitFor(() => expect(store.loadedPaths.has(root)).toBe(true));
    const at = (relative: string) => path.join(root, relative);
    // Opening folders is how the view creates demand, as EditorViewStore does.
    const expanded = new Set<string>();
    const settled = (folders: readonly string[]) =>
      vi.waitFor(() =>
        expect(
          folders.every(
            (folder) => store.loadedPaths.has(folder) || store.directoryErrors.has(folder)
          )
        ).toBe(true)
      );
    const open = async (...folders: string[]) => {
      for (const folder of folders) expanded.add(folder);
      store.setExpandedPaths(expanded);
      await settled(folders);
    };
    const close = (...folders: string[]) => {
      for (const folder of folders) expanded.delete(folder);
      store.setExpandedPaths(expanded);
    };
    const reveal = async (file: string) => {
      const result = await store.revealFile(file);
      if (result.success) await open(...result.data);
      return result;
    };
    return { root, store, watcher, at, open, close, reveal };
  }

  it('lists just the root initially and a folder once it is opened', async () => {
    const { root, store, at, open } = await setup();
    expect(store.rootNodes.map((node) => node.name)).toEqual(['dest', 'src', 'README.md']);
    expect(store.loadedPaths).toEqual(new Set([root]));
    expect(store.nodes.has(at('src/deep'))).toBe(false);
    await open(at('src'));
    // src holds only deep, so they share one compacted row and deep is listed too.
    await vi.waitFor(() => expect(store.nodes.has(at('src/deep/file.ts'))).toBe(true));
    expect(store.loadedPaths.has(at('dest'))).toBe(false);
  });

  it('observes actual OS watcher events through both Wire hops', async () => {
    const { store, at, open } = await setup(true);
    await open(at('src'));
    await writeFile(at('src/native.ts'), 'native');
    await vi.waitFor(() => expect(store.nodes.has(at('src/native.ts'))).toBe(true), {
      timeout: 5000,
    });
    await rm(at('src/native.ts'));
    await vi.waitFor(() => expect(store.nodes.has(at('src/native.ts'))).toBe(false), {
      timeout: 5000,
    });
  });

  it('does not list a remembered folder underneath a collapsed folder', async () => {
    const { store, at, open } = await setup();
    store.setExpandedPaths([at('src/deep')]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(store.loadedPaths.has(at('src/deep'))).toBe(false);
    await open(at('src'), at('src/deep'));
    expect(store.nodes.has(at('src/deep/file.ts'))).toBe(true);
  });

  it('lists restored nested folders together', async () => {
    const { store, at } = await setup();
    store.setExpandedPaths([at('src'), at('src/deep')]);
    await vi.waitFor(() => expect(store.nodes.has(at('src/deep/file.ts'))).toBe(true));
    expect(store.loadedPaths.has(at('dest'))).toBe(false);
  });

  it('releases a folder when it is collapsed and serves it again when reopened', async () => {
    const { store, at, open, close } = await setup();
    await open(at('src'));
    close(at('src'));
    await vi.waitFor(() => expect(store.loadedPaths.has(at('src'))).toBe(false));
    await open(at('src'));
    expect(store.nodes.has(at('src/deep'))).toBe(true);
  });

  it('reveals a deep file repeatedly without timing out or blocking later folders', async () => {
    const { store, at, open, reveal } = await setup();
    for (let index = 0; index < 10; index += 1) {
      await expect(reveal(at('src/deep/file.ts'))).resolves.toEqual(
        ok([at('src'), at('src/deep')])
      );
    }
    await open(at('dest'));
    expect(store.loadedPaths.has(at('dest'))).toBe(true);
    expect(store.nodes.has(at('src/deep/file.ts'))).toBe(true);
  });

  it('settles concurrent duplicate and overlapping reveals', async () => {
    const { store, at, open } = await setup();
    const reveals = Array.from({ length: 12 }, () => store.revealFile(at('src/deep/file.ts')));
    expect((await Promise.all(reveals)).every((result) => result.success)).toBe(true);
    await open(at('dest'));
  });

  it('rereads listed folders on Refresh when watcher events were missed', async () => {
    const { store, at, open } = await setup();
    await open(at('src'));
    await writeFile(at('src/missed.ts'), 'new');
    expect(store.nodes.has(at('src/missed.ts'))).toBe(false);
    await expect(store.refresh()).resolves.toEqual(ok(undefined));
    await vi.waitFor(() => expect(store.nodes.has(at('src/missed.ts'))).toBe(true));
  });

  it('shows a folder that cannot be listed and repairs it through Refresh', async () => {
    const { store, at, open } = await setup();
    await rm(at('dest'), { recursive: true });
    await open(at('dest'));
    expect(store.directoryErrors.get(at('dest'))).toContain('not-found');
    expect(store.error).toBeUndefined();
    expect(store.nodes.has(at('README.md'))).toBe(true);
    await mkdir(at('dest'));
    await writeFile(at('dest/recovered.ts'), 'recovered');
    await expect(store.refresh()).resolves.toEqual(ok(undefined));
    await vi.waitFor(() => expect(store.nodes.has(at('dest/recovered.ts'))).toBe(true));
    expect(store.directoryErrors.get(at('dest'))).toBeUndefined();
  });

  it('retries one failed folder without touching the rest of the tree', async () => {
    const { store, at, open } = await setup();
    await rm(at('dest'), { recursive: true });
    await open(at('dest'));
    await mkdir(at('dest'));
    await writeFile(at('dest/new.ts'), 'new');
    await expect(store.retry(at('dest'))).resolves.toEqual(ok(undefined));
    await vi.waitFor(() => expect(store.nodes.has(at('dest/new.ts'))).toBe(true));
  });

  it('reflects create, rename, move, copy and delete before each operation returns', async () => {
    const { store, at, open } = await setup();
    await open(at('dest'), at('src'));
    await expect(store.createFile(at('src/new.ts'))).resolves.toEqual(ok(undefined));
    await vi.waitFor(() => expect(store.nodes.has(at('src/new.ts'))).toBe(true));
    await store.rename(at('src/new.ts'), 'renamed.ts');
    await vi.waitFor(() => expect(store.nodes.has(at('src/renamed.ts'))).toBe(true));
    expect(store.nodes.has(at('src/new.ts'))).toBe(false);
    await store.move(at('src/renamed.ts'), at('dest'));
    await vi.waitFor(() => expect(store.nodes.has(at('dest/renamed.ts'))).toBe(true));
    expect(store.nodes.has(at('src/renamed.ts'))).toBe(false);
    await store.copy(at('dest/renamed.ts'), at('src'), 'copy.ts');
    await vi.waitFor(() => expect(store.nodes.has(at('src/copy.ts'))).toBe(true));
    await store.deleteEntry(at('dest/renamed.ts'));
    await vi.waitFor(() => expect(store.nodes.has(at('dest/renamed.ts'))).toBe(false));
    await expect(readFile(at('src/copy.ts'), 'utf8')).resolves.toBe('');
  });

  it('reflects directory creation and subtree deletion', async () => {
    const { store, at, reveal } = await setup();
    await store.createDirectory(at('new-folder'));
    await vi.waitFor(() => expect(store.nodes.get(at('new-folder'))?.type).toBe('directory'));
    await reveal(at('src/deep/file.ts'));
    await expect(store.deleteEntry(at('src'), true)).resolves.toEqual(ok(undefined));
    await vi.waitFor(() =>
      expect([...store.nodes.keys()].filter((entry) => entry.startsWith(at('src')))).toEqual([])
    );
    expect(store.nodes.has(at('README.md'))).toBe(true);
  });

  it('reconciles external creates, renames, deletes and resyncs', async () => {
    const { store, watcher, at, open } = await setup();
    await open(at('src'));
    await writeFile(at('src/external.ts'), 'external');
    watcher.emit([{ kind: 'create', path: at('src/external.ts') }]);
    await vi.waitFor(() => expect(store.nodes.has(at('src/external.ts'))).toBe(true));
    await rename(at('src/external.ts'), at('src/renamed.ts'));
    watcher.emit([
      { kind: 'delete', path: at('src/external.ts') },
      { kind: 'create', path: at('src/renamed.ts') },
    ]);
    await vi.waitFor(() => expect(store.nodes.has(at('src/renamed.ts'))).toBe(true));
    expect(store.nodes.has(at('src/external.ts'))).toBe(false);
    await rm(at('src/renamed.ts'));
    watcher.resync();
    await vi.waitFor(() => expect(store.nodes.has(at('src/renamed.ts'))).toBe(false));
    expect(store.loadedPaths.has(at('src'))).toBe(true);
  });

  it('applies exclusion settings to the projection without listing again', async () => {
    const { store, at, reveal } = await setup();
    await reveal(at('src/deep/file.ts'));
    store.setExclusions(['src']);
    expect(store.nodes.has(at('src'))).toBe(false);
    expect(store.nodes.has(at('src/deep/file.ts'))).toBe(false);
    expect(store.nodes.has(at('README.md'))).toBe(true);
    store.setExclusions([]);
    expect(store.nodes.has(at('src/deep/file.ts'))).toBe(true);
  });

  it('traverses directory symlinks, reports broken links, and deletes only a link', async () => {
    const { store, at, reveal } = await setup();
    await symlink('src', at('linked'), 'dir');
    await symlink('missing', at('broken'), 'file');
    await expect(store.refresh()).resolves.toEqual(ok(undefined));
    await expect(reveal(at('linked/deep/file.ts'))).resolves.toMatchObject({ success: true });
    expect(store.nodes.get(at('linked'))?.symlink?.targetType).toBe('directory');
    expect(store.nodes.get(at('broken'))?.symlink?.broken).toBe(true);
    await store.deleteEntry(at('linked'));
    await vi.waitFor(() => expect(store.nodes.has(at('linked'))).toBe(false));
    await expect(readFile(at('src/deep/file.ts'), 'utf8')).resolves.toBe('original');
  });

  it('rejects reveals outside the workspace and remains usable', async () => {
    const { store, root, at } = await setup();
    await expect(store.revealFile(path.join(root, '..', 'outside.ts'))).resolves.toMatchObject({
      success: false,
    });
    await expect(store.revealFile(at('does-not-exist.ts'))).resolves.toMatchObject({
      success: false,
      error: { type: 'not-found' },
    });
    await expect(store.revealFile(at('README.md'))).resolves.toEqual(ok([]));
  });
});

class ManualWatcher implements IWatchService {
  private listeners = new Set<{ events: (events: WatchEvent[]) => void; options: WatchOptions }>();
  watch(_root: string, events: (events: WatchEvent[]) => void, options: WatchOptions = {}) {
    const listener = { events, options };
    this.listeners.add(listener);
    return {
      ready: async () => ok(undefined),
      release: async () => {
        this.listeners.delete(listener);
      },
    };
  }
  emit(events: WatchEvent[]) {
    for (const listener of this.listeners) listener.events(events);
  }
  resync() {
    for (const listener of this.listeners) listener.options.onResync?.();
  }
  async dispose() {
    this.listeners.clear();
  }
}
