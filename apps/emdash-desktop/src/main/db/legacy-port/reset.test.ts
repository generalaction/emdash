import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createFileIndexSchema } from '../file-index-schema';
import { clearDestinationDataPreservingSignIn, listUserTables, PRESERVED_KV_KEYS } from './reset';

describe('listUserTables', () => {
  it('excludes SQLite shadow tables for virtual tables', () => {
    const db = new Database(':memory:');
    try {
      db.exec(`
        CREATE TABLE app_data (id TEXT PRIMARY KEY);
        CREATE VIRTUAL TABLE search_index USING fts5(title);
        CREATE VIRTUAL TABLE legacy_index USING fts4(title);
      `);

      expect(listUserTables(db).sort()).toEqual(['app_data', 'legacy_index', 'search_index']);
    } finally {
      db.close();
    }
  });
});

describe('clearDestinationDataPreservingSignIn', () => {
  it('resets a populated file index without corrupting the FTS table', () => {
    const db = new Database(':memory:');
    try {
      db.exec(`
        CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE app_data (id TEXT PRIMARY KEY);
      `);
      createFileIndexSchema(db);
      db.prepare(`INSERT INTO app_data (id) VALUES ('row')`).run();
      db.prepare(`INSERT INTO kv (key, value, updated_at) VALUES (?, 'kept', 0)`).run(
        PRESERVED_KV_KEYS[0]
      );
      db.prepare(
        `INSERT INTO kv (key, value, updated_at) VALUES ('file_index_version', '5', 0)`
      ).run();
      db.prepare(
        `INSERT INTO workspace_files (workspace_id, path, filename) VALUES ('ws', '/repo/a.ts', 'a.ts')`
      ).run();
      db.prepare(
        `INSERT INTO workspace_file_index_meta
         (workspace_id, indexed_at, root_path, status, file_count, truncate_reason)
         VALUES ('ws', 0, '/repo', 'complete', 1, NULL)`
      ).run();

      clearDestinationDataPreservingSignIn(db);

      expect(db.prepare(`SELECT COUNT(*) AS count FROM app_data`).get()).toEqual({ count: 0 });
      expect(db.prepare(`SELECT COUNT(*) AS count FROM workspace_files`).get()).toEqual({
        count: 0,
      });
      expect(db.prepare(`SELECT COUNT(*) AS count FROM workspace_file_index_meta`).get()).toEqual({
        count: 0,
      });
      expect(
        db
          .prepare(`SELECT path FROM workspace_file_index WHERE workspace_file_index MATCH ?`)
          .all('"a.ts"')
      ).toEqual([]);
      expect(() =>
        db
          .prepare(
            `INSERT INTO workspace_file_index(workspace_file_index, rank) VALUES ('integrity-check', 1)`
          )
          .run()
      ).not.toThrow();
      expect(db.prepare(`SELECT value FROM kv WHERE key = ?`).get(PRESERVED_KV_KEYS[0])).toEqual({
        value: 'kept',
      });
    } finally {
      db.close();
    }
  });
});
