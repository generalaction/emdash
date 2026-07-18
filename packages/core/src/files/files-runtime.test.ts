import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  IWatchService,
  WatchEvent,
  WatchHandle,
  WatchOptions,
} from '../services/fs-watch/api';
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

describe('FilesRuntime', () => {
  it('wires file tree and change feeds through the same watch root without broad ignores', async () => {
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
    expect(watcher.watches[0].options.ignore).toBeUndefined();
    expect(watcher.watches[1].options.ignore).toBeUndefined();

    changes.data.unsubscribe();
    await fileTree.data.release();
    await runtime.dispose();
  });

  it('rejects relative roots for scoped services', async () => {
    const watcher = new RecordingWatchService();
    const runtime = new FilesRuntime({ watcher });

    await expect(runtime.openTree('relative-root')).resolves.toMatchObject({
      success: false,
      error: { type: 'invalid-path' },
    });
    expect(runtime.watchChanges('relative-root', () => {})).toMatchObject({
      success: false,
      error: { type: 'invalid-path' },
    });
    expect(watcher.watches).toEqual([]);

    await runtime.dispose();
  });

  it('opens file systems without acquiring a watch subscription', async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, 'file.txt'), 'content');
    const watcher = new RecordingWatchService();
    const runtime = new FilesRuntime({ watcher });

    const fileSystem = runtime.fileSystem();
    expect(fileSystem.success).toBe(true);
    if (!fileSystem.success) return;

    await expect(fileSystem.data.readText(path.join(root, 'file.txt'))).resolves.toMatchObject({
      success: true,
      data: { content: 'content', truncated: false, totalSize: 7 },
    });
    expect(watcher.watches).toEqual([]);

    await runtime.dispose();
  });

  it('copies files across roots and creates the destination parent', async () => {
    const sourceRoot = await makeRoot();
    const destRoot = await makeRoot();
    await mkdir(path.join(sourceRoot, 'config'), { recursive: true });
    await writeFile(path.join(sourceRoot, 'config', '.env'), 'SECRET=1', 'utf8');
    await chmod(path.join(sourceRoot, 'config', '.env'), 0o640);
    const watcher = new RecordingWatchService();
    const runtime = new FilesRuntime({ watcher });

    const fileSystem = runtime.fileSystem();
    expect(fileSystem.success).toBe(true);
    if (!fileSystem.success) return;

    await expect(
      fileSystem.data.copyFile(
        path.join(sourceRoot, 'config/.env'),
        path.join(destRoot, 'nested/.env')
      )
    ).resolves.toEqual({ success: true, data: undefined });

    await expect(readFile(path.join(destRoot, 'nested', '.env'), 'utf8')).resolves.toBe('SECRET=1');
    expect((await stat(path.join(destRoot, 'nested', '.env'))).mode & 0o777).toBe(0o640);
    expect(watcher.watches).toEqual([]);

    await runtime.dispose();
  });
});
