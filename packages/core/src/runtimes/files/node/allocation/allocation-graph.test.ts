import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { err, ok } from '@emdash/shared';
import { peek } from '@emdash/wire/state';
import { afterEach, describe, expect, it } from 'vitest';
import { relativePath, runtimeRoot } from '#runtimes/files/node/testing/paths';
import type { IWatchService, WatchOptions } from '#services/fs-watch/api';
import { FilesAllocationGraph } from './allocation-graph';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('FilesAllocationGraph', () => {
  it('shares one listing per folder and pools root watchers with content', async () => {
    const root = await makeRoot();
    let watchCount = 0;
    let releaseCount = 0;
    const watcher: IWatchService = {
      watch: () => {
        watchCount += 1;
        return {
          ready: async () => ok(undefined),
          release: async () => {
            releaseCount += 1;
          },
        };
      },
      dispose: async () => {},
    };
    const graph = new FilesAllocationGraph({ watcher, idleTtlMs: 10_000 });
    const rootRef = runtimeRoot(root);
    const listingA = graph.acquireListing({ root: rootRef, path: relativePath('') });
    const listingB = graph.acquireListing({ root: rootRef, path: relativePath('') });
    const contentA = graph.acquireContent({ path: runtimeRoot(path.join(root, 'file.txt')) });
    const contentB = graph.acquireContent({ path: runtimeRoot(path.join(root, 'file.txt')) });

    expect((await listingA.ready()).state).toBe((await listingB.ready()).state);
    expect(await contentA.ready()).toBe(await contentB.ready());
    // One recursive watch shared by the listings plus one children-scoped
    // per-file watch shared by the content sessions of the same file.
    expect(watchCount).toBe(2);

    await Promise.all([
      listingA.release(),
      listingB.release(),
      contentA.release(),
      contentB.release(),
    ]);
    await graph.dispose();
    expect(releaseCount).toBe(2);
  });

  it('serves acquisitions when watch startup fails and reports the error', async () => {
    const root = await makeRoot();
    const errors: string[] = [];
    const watcher: IWatchService = {
      watch: () => ({
        ready: async () => err(new Error('watch failed')),
        release: async () => {},
      }),
      dispose: async () => {},
    };
    const graph = new FilesAllocationGraph({
      watcher,
      idleTtlMs: 0,
      onError: (context) => errors.push(context),
    });
    const rootRef = runtimeRoot(root);

    const listing = graph.acquireListing({ root: rootRef, path: relativePath('') });
    expect(peek((await listing.ready()).state)).toEqual({ status: 'ready', entries: {} });
    await expect
      .poll(() => errors.some((context) => context.includes('files root watch')))
      .toBe(true);
    await listing.release();
    await graph.dispose();
  });

  it('pools one children-scoped parent watch for absolute-path content', async () => {
    const root = await makeRoot();
    const watched: { root: string; options: WatchOptions | undefined }[] = [];
    const watcher: IWatchService = {
      watch: (watchRoot, _onEvents, options) => {
        watched.push({ root: watchRoot, options });
        return {
          ready: async () => ok(undefined),
          release: async () => {},
        };
      },
      dispose: async () => {},
    };
    const graph = new FilesAllocationGraph({
      watcher,
      watchIgnoreGlobs: ['**/node_modules/**'],
      idleTtlMs: 10_000,
    });

    const first = graph.acquireContent({ path: runtimeRoot(path.join(root, 'a.txt')) });
    const second = graph.acquireContent({ path: runtimeRoot(path.join(root, 'b.txt')) });
    expect(await first.ready()).not.toBe(await second.ready());
    expect(watched).toEqual([{ root, options: expect.objectContaining({ ignore: ['*/**'] }) }]);

    await Promise.all([first.release(), second.release()]);
    await graph.dispose();
  });

  it('passes configured watcher ignore globs to root watchers', async () => {
    const root = await makeRoot();
    let watchOptions: WatchOptions | undefined;
    const watcher: IWatchService = {
      watch: (_root, _onEvents, options) => {
        watchOptions = options;
        return {
          ready: async () => ok(undefined),
          release: async () => {},
        };
      },
      dispose: async () => {},
    };
    const graph = new FilesAllocationGraph({
      watcher,
      watchIgnoreGlobs: ['**/node_modules/**'],
      idleTtlMs: 10_000,
    });

    const listing = graph.acquireListing({ root: runtimeRoot(root), path: relativePath('') });
    await listing.ready();
    await listing.release();
    await graph.dispose();

    expect(watchOptions?.ignore).toEqual(['**/node_modules/**']);
  });

  it('watches a listed folder the root watch ignores through its own children watch', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'node_modules'));
    const watched: { root: string; options: WatchOptions | undefined }[] = [];
    const watcher: IWatchService = {
      watch: (watchRoot, _onEvents, options) => {
        watched.push({ root: watchRoot, options });
        return {
          ready: async () => ok(undefined),
          release: async () => {},
        };
      },
      dispose: async () => {},
    };
    const graph = new FilesAllocationGraph({
      watcher,
      watchIgnoreGlobs: ['**/node_modules/**'],
      idleTtlMs: 10_000,
    });
    const rootRef = runtimeRoot(root);

    const top = graph.acquireListing({ root: rootRef, path: relativePath('') });
    const dependencies = graph.acquireListing({
      root: rootRef,
      path: relativePath('node_modules'),
    });
    await Promise.all([top.ready(), dependencies.ready()]);

    await expect.poll(() => watched.length).toBe(2);
    expect(watched).toEqual([
      { root, options: expect.objectContaining({ ignore: ['**/node_modules/**'] }) },
      {
        root: path.join(root, 'node_modules'),
        options: expect.objectContaining({ ignore: ['*/**'] }),
      },
    ]);

    await Promise.all([top.release(), dependencies.release()]);
    await graph.dispose();
  });
});

async function makeRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'emdash-files-allocation-')));
  roots.push(root);
  return root;
}
