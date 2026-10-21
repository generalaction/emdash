import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ok } from '@emdash/shared';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import { cell } from '@emdash/wire/state';
import { createTestWire } from '@emdash/wire/testing';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { StoreHandle } from '#primitives/sqlite-store/api';
import { fileSearchContract } from '#runtimes/file-search/api';
import type { RootIndex, RootIndexStatus } from '../path/index/root-index';
import type { WatchSupervisorHealth } from '../path/index/watch-supervisor';
import type { RegisteredRoot, StoredFileSearchRoot } from '../root/registered-root';
import { NodeFileSearchRootResolver } from '../root/root-identity';
import { FileSearchRootRegistry } from '../root/root-registry';
import { SqliteFileSearchStore } from '../storage/sqlite-file-search-store';
import { fileSearchStore, type FileSearchDb } from '../storage/store';
import { hostPath as absolute } from '../testing/paths';
import { createActiveRootHost } from './active-root-host';
import { createFileSearchController } from './controller';
import type { FileSearchRuntimeApi } from './procedures';

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe('createActiveRootHost', () => {
  it('publishes active status derived from the index cells', async () => {
    const rootPath = await createRoot();
    const root = absolute(rootPath);
    const wire = createWire((record, scope, fingerprint) => ({
      record,
      scope,
      exclusionsFingerprint: fingerprint,
      // Only the reactive getters the host consumes; RootIndex is a class, so
      // the structural stub needs the double cast.
      index: {
        statusChanges: cell<RootIndexStatus>({
          kind: 'failed',
          failure: { expected: { type: 'io', root, message: 'index storage failed' } },
        }),
        watcherHealthChanges: cell<WatchSupervisorHealth>('degraded'),
      } as unknown as RootIndex,
    }));

    await expect(
      wire.client.activeRoot.state({ root }, 'status').snapshot()
    ).resolves.toMatchObject({
      data: { phase: 'active', availability: 'failed', watcher: 'degraded' },
    });
  });

  it('reports acquisition failures through the failed status phase', async () => {
    const rootPath = await createRoot();
    const missing = absolute(path.join(rootPath, 'missing'));
    const wire = createWire();

    await expect(
      wire.client.activeRoot.state({ root: missing }, 'status').snapshot()
    ).resolves.toMatchObject({
      data: { phase: 'failed', error: { type: 'root-unavailable', reason: 'not-found' } },
    });
  });
});

function createWire(
  createRegisteredRoot?: (
    record: StoredFileSearchRoot,
    scope: Scope,
    fingerprint: string
  ) => RegisteredRoot
) {
  const handle: StoreHandle<FileSearchDb, Database.Database> = fileSearchStore.open(':memory:');
  const scope = createScope({ label: 'active-root-host-test' });
  const registry = new FileSearchRootRegistry({
    catalog: new SqliteFileSearchStore(handle),
    resolver: new NodeFileSearchRootResolver(),
    createRoot: (record, rootScope, _exclusions, fingerprint) =>
      createRegisteredRoot
        ? createRegisteredRoot(record, rootScope, fingerprint)
        : { record, scope: rootScope, exclusionsFingerprint: fingerprint, index: {} as RootIndex },
    compileExclusions: () => ({
      excludes: () => false,
      ripgrepGlobs: () => [],
      watchIgnoreGlobs: () => [],
    }),
    defaultExclusionPatterns: [],
    scope,
  });
  const host = createActiveRootHost({ registry, scope });
  const runtime: FileSearchRuntimeApi = {
    activeRoots: host,
    evictRoot: async () => ok(),
    searchPaths: async () => ok({ hits: [] }),
    searchContent: async () => ok({ files: [], complete: true }),
  };
  const wire = createTestWire(fileSearchContract, createFileSearchController(runtime));
  cleanups.push(async () => {
    wire.dispose();
    await host.dispose();
    await registry.dispose();
    await scope.dispose();
    handle.close();
  });
  return wire;
}

async function createRoot(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'emdash-active-root-host-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  return realpath(directory);
}
