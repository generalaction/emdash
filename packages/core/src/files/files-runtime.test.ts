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
});
