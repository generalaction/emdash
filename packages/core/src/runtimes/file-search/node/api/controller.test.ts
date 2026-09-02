import { ok } from '@emdash/shared';
import { createLiveJobReplicaCache } from '@emdash/wire/live';
import { cell, expose } from '@emdash/wire/state';
import { createTestWire } from '@emdash/wire/testing';
import { describe, expect, it } from 'vitest';
import { fileSearchContract, type ActiveRootStatus } from '#runtimes/file-search/api';
import { hostPath as absolute, relativePath as relative } from '../testing/paths';
import { createFileSearchController } from './controller';
import type { FileSearchRuntimeApi } from './procedures';

describe('createFileSearchController', () => {
  it('adapts lease, path, content, and eviction operations to the Wire contract', async () => {
    const files = [
      {
        path: relative('index.ts'),
        matches: [
          {
            lineNumber: 1,
            previewText: 'const VALUE = 1;',
            locations: [
              {
                sourceRange: { startColumn: 7, endColumn: 12 },
                previewRange: { startColumn: 7, endColumn: 12 },
              },
            ],
          },
        ],
      },
    ];
    const activeRoots = expose(
      fileSearchContract.activeRoot,
      {
        status: () =>
          cell<ActiveRootStatus>({ phase: 'active', availability: 'searchable', watcher: 'live' }),
      },
      { lingerMs: 0 }
    );
    const runtime: FileSearchRuntimeApi = {
      activeRoots,
      evictRoot: async () => ok(),
      searchPaths: async () => ok({ hits: [{ path: relative('index.ts'), kind: 'file' }] }),
      searchContent: async (_input, context) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        context.onProgress({ files });
        return ok({ files, complete: true });
      },
    };
    const wire = createTestWire(fileSearchContract, createFileSearchController(runtime));
    const root = absolute('/workspace');

    try {
      await expect(
        wire.client.activeRoot.state({ root }, 'status').snapshot()
      ).resolves.toMatchObject({
        data: { phase: 'active', availability: 'searchable', watcher: 'live' },
      });
      await expect(
        wire.client.searchPaths({ root, query: 'index', kinds: ['file'] })
      ).resolves.toEqual({
        success: true,
        data: { hits: [{ path: 'index.ts', kind: 'file' }] },
      });

      const jobs = createLiveJobReplicaCache(
        fileSearchContract.searchContent,
        wire.client.searchContent
      );
      const lease = await jobs.start({ root, query: 'VALUE' });
      const handle = await lease.ready();
      const progress: unknown[] = [];
      handle.onProgress((update) => progress.push(update));
      await expect(handle.result).resolves.toEqual({ files, complete: true });
      expect(progress).toEqual([{ files }]);
      await lease.release();
      await jobs.dispose();

      await expect(wire.client.evictRoot({ root })).resolves.toEqual({
        success: true,
        data: undefined,
      });
    } finally {
      wire.dispose();
      await activeRoots.dispose();
    }
  });
});
