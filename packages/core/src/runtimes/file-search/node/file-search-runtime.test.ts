import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ok } from '@emdash/shared';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoreHandle } from '#primitives/sqlite-store/api';
import type { IWatchService } from '#services/fs-watch/api';
import { FileSearchRuntime } from './file-search-runtime';
import { fileSearchStore, type FileSearchDb } from './storage/store';
import { hostPath as absolute } from './testing/paths';

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe('FileSearchRuntime', () => {
  it('composes root lifecycle and path search behind a flat runtime API', async () => {
    const rootPath = await createRoot();
    await mkdir(path.join(rootPath, 'src'));
    await writeFile(path.join(rootPath, 'src', 'index.ts'), 'export {}');
    const runtime = createRuntime();
    const root = absolute(rootPath);

    await expect(
      runtime.searchPaths({ root, query: '', kinds: ['file', 'directory'] })
    ).resolves.toMatchObject({ success: false, error: { type: 'root-not-registered' } });
    await expect(runtime.registerRoot({ root })).resolves.toEqual({
      success: true,
      data: undefined,
    });

    await vi.waitFor(async () => {
      expect(
        await runtime.searchPaths({ root, query: 'index', kinds: ['file'], limit: 20 })
      ).toEqual({
        success: true,
        data: { hits: [{ path: 'src/index.ts', kind: 'file' }] },
      });
    });

    await expect(runtime.unregisterRoot({ root })).resolves.toEqual({
      success: true,
      data: undefined,
    });
    await expect(runtime.unregisterRoot({ root })).resolves.toEqual({
      success: true,
      data: undefined,
    });
    // Unregister deletes the durable row, so no cold generation remains either.
    await expect(runtime.searchPaths({ root, query: '', kinds: ['file'] })).resolves.toMatchObject({
      success: false,
      error: { type: 'root-not-registered' },
    });
  });

  it('serves persisted generations cold in a new runtime without starting watchers', async () => {
    const parent = await createRoot();
    const rootPath = path.join(parent, 'workspace');
    const databasePath = path.join(parent, 'file-search.db');
    await mkdir(rootPath);
    await writeFile(path.join(rootPath, 'restored.ts'), 'export {}');
    const root = absolute(rootPath);

    const first = createRuntime(databasePath);
    await first.registerRoot({ root });
    await vi.waitFor(async () => {
      expect(await first.searchPaths({ root, query: '', kinds: ['file'] })).toMatchObject({
        success: true,
      });
    });
    await first.dispose();

    // Persisted rows are cold cache, not registrations: the new runtime serves
    // the published generation immediately and attaches zero watchers.
    const watcher = new CountingWatchService();
    const second = createRuntime(databasePath, watcher);
    await expect(second.searchPaths({ root, query: '', kinds: ['file'] })).resolves.toEqual({
      success: true,
      data: { hits: [{ path: 'restored.ts', kind: 'file' }] },
    });
    expect(watcher.watchCount).toBe(0);
  });
});

class NoopWatchService implements IWatchService {
  watch() {
    return { ready: async () => ok(undefined), release: async () => {} };
  }

  async dispose(): Promise<void> {}
}

class CountingWatchService extends NoopWatchService {
  watchCount = 0;

  override watch(): ReturnType<NoopWatchService['watch']> {
    this.watchCount += 1;
    return super.watch();
  }
}

function createRuntime(
  databasePath = ':memory:',
  watcher: IWatchService = new NoopWatchService()
): FileSearchRuntime {
  const handle: StoreHandle<FileSearchDb, Database.Database> = fileSearchStore.open(databasePath);
  const runtime = new FileSearchRuntime({ handle, watcher });
  cleanups.push(async () => {
    await runtime.dispose();
    handle.close();
  });
  return runtime;
}

async function createRoot(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'emdash-file-search-runtime-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  return realpath(directory);
}
