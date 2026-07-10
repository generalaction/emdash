import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IWatchService } from '@emdash/core/watch';
import { afterEach, describe, expect, it } from 'vitest';
import { FilesAllocationGraph } from './allocation-graph';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('FilesAllocationGraph', () => {
  it('pools one root watcher across tree sessions and shared content', async () => {
    const root = await makeRoot();
    let watchCount = 0;
    let releaseCount = 0;
    const watcher: IWatchService = {
      watch: () => {
        watchCount += 1;
        return {
          ready: async () => {},
          release: async () => {
            releaseCount += 1;
          },
        };
      },
      dispose: async () => {},
    };
    const graph = new FilesAllocationGraph({ watcher, idleTtlMs: 10_000 });
    const treeA = graph.acquireTree({ rootPath: root, sessionId: 'a' });
    const treeB = graph.acquireTree({ rootPath: root, sessionId: 'b' });
    const contentA = graph.acquireContent({ rootPath: root, path: 'file.txt' });
    const contentB = graph.acquireContent({ rootPath: root, path: 'file.txt' });

    expect(await treeA.ready()).not.toBe(await treeB.ready());
    expect(await contentA.ready()).toBe(await contentB.ready());
    expect(watchCount).toBe(1);

    await Promise.all([treeA.release(), treeB.release(), contentA.release(), contentB.release()]);
    await graph.dispose();
    expect(releaseCount).toBe(1);
  });

  it('evicts a failed root acquisition so it can be retried', async () => {
    const root = await makeRoot();
    let attempt = 0;
    const watcher: IWatchService = {
      watch: () => {
        attempt += 1;
        return {
          ready: async () => {
            if (attempt === 1) throw new Error('watch failed');
          },
          release: async () => {},
        };
      },
      dispose: async () => {},
    };
    const graph = new FilesAllocationGraph({ watcher, idleTtlMs: 0 });

    await expect(graph.acquireTree({ rootPath: root, sessionId: 'one' }).ready()).rejects.toThrow(
      'watch failed'
    );
    const retry = graph.acquireTree({ rootPath: root, sessionId: 'one' });
    await expect(retry.ready()).resolves.toMatchObject({ identity: { sessionId: 'one' } });
    await retry.release();
    await graph.dispose();
    expect(attempt).toBe(2);
  });
});

async function makeRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'emdash-files-allocation-')));
  roots.push(root);
  return root;
}
