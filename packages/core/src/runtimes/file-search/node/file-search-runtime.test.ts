import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseAbsolute, type HostAbsolutePath } from '@primitives/path/api';
import type { IWatchService } from '@services/fs-watch/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileSearchRuntime } from './file-search-runtime';

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe('FileSearchRuntime', () => {
  it('composes root lifecycle and path search behind slim domain runtimes', async () => {
    const rootPath = await createRoot();
    await mkdir(path.join(rootPath, 'src'));
    await writeFile(path.join(rootPath, 'src', 'index.ts'), 'export {}');
    const runtime = createRuntime();
    const root = absolute(rootPath);

    await expect(
      runtime.paths.searchPaths({ root, query: '', kinds: ['file', 'directory'] })
    ).resolves.toMatchObject({ success: false, error: { type: 'root-not-registered' } });
    await expect(runtime.roots.registerRoot({ root })).resolves.toEqual({
      success: true,
      data: undefined,
    });

    await vi.waitFor(async () => {
      expect(
        await runtime.paths.searchPaths({ root, query: 'index', kinds: ['file'], limit: 20 })
      ).toEqual({
        success: true,
        data: { hits: [{ path: 'src/index.ts', kind: 'file' }] },
      });
    });

    await expect(runtime.roots.unregisterRoot({ root })).resolves.toEqual({
      success: true,
      data: undefined,
    });
    await expect(runtime.roots.unregisterRoot({ root })).resolves.toEqual({
      success: true,
      data: undefined,
    });
  });

  it('preserves durable root rows on shutdown and restores them in a new runtime', async () => {
    const parent = await createRoot();
    const rootPath = path.join(parent, 'workspace');
    const databasePath = path.join(parent, 'file-search.db');
    await mkdir(rootPath);
    await writeFile(path.join(rootPath, 'restored.ts'), 'export {}');
    const root = absolute(rootPath);

    const first = createRuntime(databasePath);
    await first.roots.registerRoot({ root });
    await vi.waitFor(async () => {
      expect(await first.paths.searchPaths({ root, query: '', kinds: ['file'] })).toMatchObject({
        success: true,
      });
    });
    await first.dispose();

    const second = createRuntime(databasePath);
    await vi.waitFor(async () => {
      expect(await second.paths.searchPaths({ root, query: '', kinds: ['file'] })).toEqual({
        success: true,
        data: { hits: [{ path: 'restored.ts', kind: 'file' }] },
      });
    });
  });
});

class NoopWatchService implements IWatchService {
  watch() {
    return { ready: async () => {}, release: async () => {} };
  }

  async dispose(): Promise<void> {}
}

function createRuntime(databasePath = ':memory:'): FileSearchRuntime {
  const runtime = new FileSearchRuntime({
    databasePath,
    watcher: new NoopWatchService(),
  });
  cleanups.push(() => runtime.dispose());
  return runtime;
}

async function createRoot(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'emdash-file-search-runtime-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  return realpath(directory);
}

function absolute(input: string): HostAbsolutePath {
  const parsed = parseAbsolute(input, {
    profile: { style: path.sep === '\\' ? 'win32' : 'posix' },
  });
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
}
