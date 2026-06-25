import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { IWatchService, WatchEvent, WatchHandle, WatchOptions } from '../watch';
import { FilesRuntime } from './files-runtime';

class RecordingWatchService implements IWatchService {
  readonly watches: Array<{
    root: string;
    options: WatchOptions;
  }> = [];

  watch(
    root: string,
    _onEvents: (events: WatchEvent[]) => void,
    options: WatchOptions = {}
  ): WatchHandle {
    this.watches.push({ root, options });
    return {
      ready: async () => {},
      release: async () => {},
    };
  }

  async dispose(): Promise<void> {}
}

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'emdash-files-runtime-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function collect(iterable: AsyncIterable<string>): Promise<string[]> {
  const paths: string[] = [];
  for await (const relPath of iterable) paths.push(relPath);
  return paths;
}

describe('FilesRuntime', () => {
  it('wires file tree and change feeds through the same watch root and ignore set', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src/index.ts'), 'content');
    const watcher = new RecordingWatchService();
    const runtime = new FilesRuntime({ watcher });

    const fileTree = await runtime.openTree(root);
    expect(fileTree.success).toBe(true);
    if (!fileTree.success) return;

    const changes = runtime.watchChanges(root, () => {});
    expect(changes.success).toBe(true);
    if (!changes.success) return;

    expect(watcher.watches).toHaveLength(2);
    expect(watcher.watches[0].root).toBe(watcher.watches[1].root);
    expect(watcher.watches[0].options.ignore).toEqual(watcher.watches[1].options.ignore);

    changes.data.unsubscribe();
    await fileTree.data.release();
    await runtime.dispose();
  });

  it('enumerates files without acquiring a watch subscription', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src/index.ts'), 'content');
    await writeFile(path.join(root, '.env'), 'env');
    const watcher = new RecordingWatchService();
    const runtime = new FilesRuntime({ watcher });

    const enumeration = runtime.enumerate(root);
    expect(enumeration.success).toBe(true);
    if (!enumeration.success) return;

    await expect(collect(enumeration.data)).resolves.toEqual(['.env', 'src/index.ts']);
    expect(watcher.watches).toEqual([]);

    await runtime.dispose();
  });

  it('opens file systems without acquiring a watch subscription', async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, 'file.txt'), 'content');
    const watcher = new RecordingWatchService();
    const runtime = new FilesRuntime({ watcher });

    const fileSystem = runtime.fileSystem(root);
    expect(fileSystem.success).toBe(true);
    if (!fileSystem.success) return;

    await expect(fileSystem.data.readText('file.txt')).resolves.toMatchObject({
      success: true,
      data: { content: 'content', truncated: false, totalSize: 7 },
    });
    expect(watcher.watches).toEqual([]);

    await runtime.dispose();
  });
});
