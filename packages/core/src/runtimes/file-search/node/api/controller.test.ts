import { ok } from '@emdash/shared';
import { createLiveJobReplica } from '@emdash/wire';
import { createTestWire } from '@emdash/wire/testing';
import { parseAbsolute, parsePortableRelativePath } from '@primitives/path/api';
import { fileSearchContract } from '@runtimes/file-search/api';
import { describe, expect, it } from 'vitest';
import { createFileSearchController } from './controller';
import type { FileSearchRuntimeApi } from './procedures';

describe('createFileSearchController', () => {
  it('adapts root, path, and progressive content operations to the Wire contract', async () => {
    const files = [
      {
        path: relative('index.ts'),
        matches: [
          {
            lineNumber: 1,
            text: 'const VALUE = 1;',
            ranges: [{ startColumn: 7, endColumn: 12 }],
          },
        ],
      },
    ];
    const runtime: FileSearchRuntimeApi = {
      roots: {
        registerRoot: async () => ok(),
        unregisterRoot: async () => ok(),
      },
      paths: {
        searchPaths: async () => ok({ hits: [{ path: relative('index.ts'), kind: 'file' }] }),
      },
      content: {
        searchContent: async (_input, context) => {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          context.onProgress({ files });
          return ok({ files, limitHit: false });
        },
      },
    };
    const wire = createTestWire(fileSearchContract, createFileSearchController(runtime), {
      validate: 'full',
    });
    const root = absolute('/workspace');

    try {
      await expect(wire.client.registerRoot({ root })).resolves.toEqual({
        success: true,
        data: undefined,
      });
      await expect(
        wire.client.searchPaths({ root, query: 'index', kinds: ['file'] })
      ).resolves.toEqual({
        success: true,
        data: { hits: [{ path: 'index.ts', kind: 'file' }] },
      });

      const jobs = createLiveJobReplica(
        fileSearchContract.searchContent,
        wire.client.searchContent
      );
      const lease = await jobs.start({ root, query: 'VALUE' });
      const handle = await lease.ready();
      const progress: unknown[] = [];
      handle.onProgress((update) => progress.push(update));
      await expect(handle.result).resolves.toEqual({ files, limitHit: false });
      expect(progress).toEqual([{ files }]);
      await lease.release();
      await jobs.dispose();
    } finally {
      wire.dispose();
    }
  });
});

function absolute(input: string) {
  const parsed = parseAbsolute(input, { profile: { style: 'posix' } });
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
}

function relative(input: string) {
  const parsed = parsePortableRelativePath(input);
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
}
