import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RelPath } from '@emdash/core/files';
import type BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
      status: 'truncated',
      fileCount: 50_000,
      truncateReason: 'maxEntries',
    });

    expect(store.getMeta('ws-1')).toEqual({
      status: 'truncated',
      fileCount: 50_000,
      truncateReason: 'maxEntries',
    });
  });

  it('syncs rows by diffing existing paths', async () => {
    loadedStore = await loadStore();
    const { store, sqlite } = loadedStore;

    store.syncRows('ws-1', relPaths(['a.ts', 'b.ts']));
    store.syncRows('ws-1', relPaths(['b.ts', 'c.ts']));

    expect(indexedPaths(sqlite, 'ws-1')).toEqual(['b.ts', 'c.ts']);
    expect(store.countIndexedFiles('ws-1')).toBe(2);
  });

  it('returns whether insertPath added a new row', async () => {
    loadedStore = await loadStore();
    const { store, sqlite } = loadedStore;

    expect(store.insertPath('ws-1', 'src/index.ts')).toBe(true);
    expect(store.insertPath('ws-1', 'src/index.ts')).toBe(false);

    expect(indexedPaths(sqlite, 'ws-1')).toEqual(['src/index.ts']);
    expect(store.countIndexedFiles('ws-1')).toBe(1);
  });

  it('searches with the FTS query dialect', async () => {
    loadedStore = await loadStore();
    const { store } = loadedStore;

    store.syncRows('ws-1', relPaths(['README.md', 'src/index.ts', 'src/router.ts']));

    expect(store.search('ws-1', 'index')).toEqual([{ path: 'src/index.ts', filename: 'index.ts' }]);
    expect(store.search('ws-1', 'in')).toEqual([]);
  });

  it('deletes exact paths and escaped subtrees', async () => {
    loadedStore = await loadStore();
    const { store, sqlite } = loadedStore;
    store.syncRows('ws-1', relPaths(['foo_%', 'foo_%/a.ts', 'foo_%/nested/b.ts', 'foo-x/a.ts']));

    store.deletePath('ws-1', 'foo_%/a.ts');
    store.deleteSubtree('ws-1', 'foo_%');

    expect(indexedPaths(sqlite, 'ws-1')).toEqual(['foo-x/a.ts']);
  });

  it('deletes an entire workspace index', async () => {
    loadedStore = await loadStore();
    const { store, sqlite } = loadedStore;
    store.syncRows('ws-1', relPaths(['a.ts']));
    store.recordMeta('ws-1', { status: 'complete', fileCount: 1, truncateReason: null });

    store.deleteIndex('ws-1');

    expect(indexedPaths(sqlite, 'ws-1')).toEqual([]);
    expect(store.getMeta('ws-1')).toBeNull();
  });

  it('evicts stale and orphaned indexes', async () => {
    loadedStore = await loadStore();
    const { store, sqlite } = loadedStore;
    sqlite.prepare(`INSERT INTO workspaces (id) VALUES (?)`).run('fresh');

    store.syncRows('stale', relPaths(['stale.ts']));
    store.recordMeta('stale', { status: 'complete', fileCount: 1, truncateReason: null });
    store.syncRows('orphan', relPaths(['orphan.ts']));
    store.recordMeta('orphan', { status: 'complete', fileCount: 1, truncateReason: null });
    store.syncRows('fresh', relPaths(['fresh.ts']));
    store.recordMeta('fresh', { status: 'complete', fileCount: 1, truncateReason: null });
    sqlite
      .prepare(`UPDATE workspace_file_index_meta SET indexed_at = ? WHERE workspace_id = ?`)
      .run(Math.floor(Date.now() / 1000) - 15 * 86400, 'stale');

    store.evict(14);

    expect(allIndexedWorkspaces(sqlite)).toEqual(['fresh']);
    expect(indexedPaths(sqlite, 'fresh')).toEqual(['fresh.ts']);
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
  sqlite.exec(`
    CREATE VIRTUAL TABLE workspace_file_index USING fts5(
      workspace_id UNINDEXED,
      path,
      filename,
      tokenize = 'trigram case_sensitive 0'
    );
    CREATE TABLE workspace_file_index_meta (
      workspace_id     TEXT PRIMARY KEY,
      indexed_at       INTEGER NOT NULL,
      status           TEXT NOT NULL
        CHECK (status IN ('complete', 'stale', 'truncated')),
      file_count       INTEGER NOT NULL,
      truncate_reason  TEXT
        CHECK (truncate_reason IS NULL OR truncate_reason IN ('maxEntries', 'timeBudget'))
    );
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY
    );
  `);
}

function relPaths(paths: string[]): RelPath[] {
  return paths as RelPath[];
}

function indexedPaths(sqlite: BetterSqlite3.Database, workspaceId: string): string[] {
  return (
    sqlite
      .prepare(`SELECT path FROM workspace_file_index WHERE workspace_id = ? ORDER BY path`)
      .all(workspaceId) as Array<{ path: string }>
  ).map((row) => row.path);
}

function allIndexedWorkspaces(sqlite: BetterSqlite3.Database): string[] {
  return (
    sqlite
      .prepare(`SELECT DISTINCT workspace_id FROM workspace_file_index ORDER BY workspace_id`)
      .all() as Array<{ workspace_id: string }>
  ).map((row) => row.workspace_id);
}
