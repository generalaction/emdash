import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFileIndexSchema } from '@main/db/file-index-schema';

type LoadedStore = Awaited<ReturnType<typeof loadStore>>;

let loadedStore: LoadedStore | undefined;

describe('WorkspaceFileIndexStore', () => {
  afterEach(async () => {
    loadedStore?.sqlite.close();
    if (loadedStore) {
      await rm(loadedStore.tempDir, { recursive: true, force: true });
    }
    loadedStore = undefined;
    vi.resetModules();
    delete process.env.EMDASH_DB_FILE;
  });

  it('stores and reads file index metadata', async () => {
    loadedStore = await loadStore();
    const { store } = loadedStore;

    store.recordMeta('ws-1', {
      rootPath: '/repo',
      status: 'truncated',
      fileCount: 50_000,
      truncateReason: 'maxEntries',
    });

    expect(store.getMeta('ws-1')).toEqual({
      rootPath: '/repo',
      status: 'truncated',
      fileCount: 50_000,
      truncateReason: 'maxEntries',
    });
  });

  it('syncs rows by diffing existing paths', async () => {
    loadedStore = await loadStore();
    const { store, sqlite } = loadedStore;

    store.syncRows('ws-1', paths(['/repo/a.ts', '/repo/b.ts']));
    store.syncRows('ws-1', paths(['/repo/b.ts', '/repo/c.ts']));

    expect(indexedPaths(sqlite, 'ws-1')).toEqual(['/repo/b.ts', '/repo/c.ts']);
    expect(store.countIndexedFiles('ws-1')).toBe(2);
    expectFtsConsistent(sqlite);
  });

  it('returns whether insertPath added a new row', async () => {
    loadedStore = await loadStore();
    const { store, sqlite } = loadedStore;

    expect(store.insertPath('ws-1', '/repo/src/index.ts')).toBe(true);
    expect(store.insertPath('ws-1', '/repo/src/index.ts')).toBe(false);

    expect(indexedPaths(sqlite, 'ws-1')).toEqual(['/repo/src/index.ts']);
    expect(store.countIndexedFiles('ws-1')).toBe(1);
  });

  it('searches with the FTS query dialect', async () => {
    loadedStore = await loadStore();
    const { store } = loadedStore;

    store.syncRows('ws-1', paths(['/repo/README.md', '/repo/src/index.ts', '/repo/src/router.ts']));

    expect(store.search('ws-1', 'index')).toEqual([
      { path: '/repo/src/index.ts', filename: 'index.ts' },
    ]);
    expect(store.search('ws-1', 'in')).toEqual([]);
  });

  it('deletes exact paths and escaped subtrees', async () => {
    loadedStore = await loadStore();
    const { store, sqlite } = loadedStore;
    store.syncRows(
      'ws-1',
      paths(['/repo/foo_%', '/repo/foo_%/a.ts', '/repo/foo_%/nested/b.ts', '/repo/foo-x/a.ts'])
    );

    store.deletePath('ws-1', '/repo/foo_%/a.ts');
    store.deleteSubtree('ws-1', '/repo/foo_%');

    expect(indexedPaths(sqlite, 'ws-1')).toEqual(['/repo/foo-x/a.ts']);
    expectFtsConsistent(sqlite);
  });

  it('drops trigger-synced deletes from FTS search results', async () => {
    loadedStore = await loadStore();
    const { store, sqlite } = loadedStore;
    store.syncRows('ws-1', paths(['/repo/src/index.ts', '/repo/src/router.ts']));

    store.deletePath('ws-1', '/repo/src/index.ts');

    expect(store.search('ws-1', 'index')).toEqual([]);
    expect(store.search('ws-1', 'router')).toEqual([
      { path: '/repo/src/router.ts', filename: 'router.ts' },
    ]);
    expectFtsConsistent(sqlite);
  });

  it('never full-scans the FTS index for bookkeeping queries', async () => {
    loadedStore = await loadStore();
    const { sqlite } = loadedStore;

    const bookkeepingQueries = [
      `SELECT path FROM workspace_files WHERE workspace_id = 'ws'`,
      `SELECT COUNT(*) FROM workspace_files WHERE workspace_id = 'ws'`,
      `SELECT path, filename FROM workspace_files WHERE workspace_id = 'ws' ORDER BY path LIMIT 5`,
      `DELETE FROM workspace_files WHERE workspace_id = 'ws' AND path = '/repo/a.ts'`,
      `DELETE FROM workspace_files WHERE workspace_id = 'ws'`,
    ];

    for (const query of bookkeepingQueries) {
      const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${query}`).all() as Array<{
        detail: string;
      }>;
      const details = plan.map((row) => row.detail).join('; ');
      expect(details, query).not.toMatch(/SCAN workspace_file/);
      expect(details, query).toMatch(/SEARCH workspace_files USING/);
    }
  });

  it('deletes an entire workspace index', async () => {
    loadedStore = await loadStore();
    const { store, sqlite } = loadedStore;
    store.syncRows('ws-1', paths(['/repo/a.ts']));
    store.recordMeta('ws-1', {
      rootPath: '/repo',
      status: 'complete',
      fileCount: 1,
      truncateReason: null,
    });

    store.deleteIndex('ws-1');

    expect(indexedPaths(sqlite, 'ws-1')).toEqual([]);
    expect(store.getMeta('ws-1')).toBeNull();
  });

  it('evicts stale and orphaned indexes', async () => {
    loadedStore = await loadStore();
    const { store, sqlite } = loadedStore;
    sqlite.prepare(`INSERT INTO workspaces (id) VALUES (?)`).run('fresh');

    store.syncRows('stale', paths(['/repo/stale.ts']));
    store.recordMeta('stale', {
      rootPath: '/repo',
      status: 'complete',
      fileCount: 1,
      truncateReason: null,
    });
    store.syncRows('orphan', paths(['/repo/orphan.ts']));
    store.recordMeta('orphan', {
      rootPath: '/repo',
      status: 'complete',
      fileCount: 1,
      truncateReason: null,
    });
    store.syncRows('fresh', paths(['/repo/fresh.ts']));
    store.recordMeta('fresh', {
      rootPath: '/repo',
      status: 'complete',
      fileCount: 1,
      truncateReason: null,
    });
    sqlite
      .prepare(`UPDATE workspace_file_index_meta SET indexed_at = ? WHERE workspace_id = ?`)
      .run(Math.floor(Date.now() / 1000) - 15 * 86400, 'stale');

    store.evict(14);

    expect(allIndexedWorkspaces(sqlite)).toEqual(['fresh']);
    expect(indexedPaths(sqlite, 'fresh')).toEqual(['/repo/fresh.ts']);
    expectFtsConsistent(sqlite);
  });
});

async function loadStore() {
  vi.resetModules();
  const tempDir = await mkdtemp(join(tmpdir(), 'emdash-file-index-store-'));
  process.env.EMDASH_DB_FILE = join(tempDir, 'test.db');

  const [{ WorkspaceFileIndexStore }, { sqlite }] = await Promise.all([
    import('./workspace-file-index-store'),
    import('@main/db/client'),
  ]);
  createTables(sqlite);

  return {
    store: new WorkspaceFileIndexStore(),
    sqlite,
    tempDir,
  };
}

function createTables(sqlite: BetterSqlite3.Database): void {
  createFileIndexSchema(sqlite);
  sqlite.exec(`
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY
    );
  `);
}

function paths(values: string[]): string[] {
  return values;
}

function indexedPaths(sqlite: BetterSqlite3.Database, workspaceId: string): string[] {
  return (
    sqlite
      .prepare(`SELECT path FROM workspace_files WHERE workspace_id = ? ORDER BY path`)
      .all(workspaceId) as Array<{ path: string }>
  ).map((row) => row.path);
}

function allIndexedWorkspaces(sqlite: BetterSqlite3.Database): string[] {
  return (
    sqlite
      .prepare(`SELECT DISTINCT workspace_id FROM workspace_files ORDER BY workspace_id`)
      .all() as Array<{ workspace_id: string }>
  ).map((row) => row.workspace_id);
}

function expectFtsConsistent(sqlite: BetterSqlite3.Database): void {
  expect(() =>
    sqlite
      .prepare(
        `INSERT INTO workspace_file_index(workspace_file_index, rank) VALUES ('integrity-check', 1)`
      )
      .run()
  ).not.toThrow();
}
