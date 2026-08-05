import type BetterSqlite3 from 'better-sqlite3';

/**
 * Workspace file index schema, shared by initialize.ts, legacy-port/reset.ts,
 * and the db tests so the DDL lives in exactly one place.
 *
 * `workspace_files` is the source of truth: a plain table whose
 * UNIQUE(workspace_id, path) index makes every bookkeeping query (sync, count,
 * delete-by-workspace) an indexed lookup. `workspace_file_index` is an
 * external-content FTS5 table over it, kept in sync by triggers, so FTS
 * deletes resolve by rowid instead of scanning the whole trigram index
 * (issue #2882 — the previous content-owning FTS table full-scanned on every
 * `WHERE workspace_id = ?`).
 *
 * The FTS column order (workspace_id, path, filename) is load-bearing: the
 * bm25() weights in workspace-file-index-store.ts are positional.
 */
export const FILE_INDEX_TABLES = [
  // Drop order matters: the FTS virtual table must go before its content table
  // so we never operate on the FTS index while the content is gone. Dropping
  // workspace_files also drops its triggers.
  'workspace_file_index',
  'workspace_files',
  'workspace_file_index_meta',
] as const;

export function dropFileIndexSchema(connection: BetterSqlite3.Database): void {
  for (const table of FILE_INDEX_TABLES) {
    connection.exec(`DROP TABLE IF EXISTS ${table}`);
  }
}

export function createFileIndexSchema(connection: BetterSqlite3.Database): void {
  dropFileIndexSchema(connection);
  connection.exec(`
    CREATE TABLE workspace_files (
      id INTEGER PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      path TEXT NOT NULL,
      filename TEXT NOT NULL,
      UNIQUE(workspace_id, path)
    );

    CREATE VIRTUAL TABLE workspace_file_index USING fts5(
      workspace_id UNINDEXED,
      path,
      filename,
      content='workspace_files',
      content_rowid='id',
      tokenize = 'trigram case_sensitive 0'
    );

    CREATE TRIGGER workspace_files_ai AFTER INSERT ON workspace_files BEGIN
      INSERT INTO workspace_file_index(rowid, workspace_id, path, filename)
      VALUES (new.id, new.workspace_id, new.path, new.filename);
    END;

    CREATE TRIGGER workspace_files_ad AFTER DELETE ON workspace_files BEGIN
      INSERT INTO workspace_file_index(workspace_file_index, rowid, workspace_id, path, filename)
      VALUES ('delete', old.id, old.workspace_id, old.path, old.filename);
    END;

    CREATE TRIGGER workspace_files_au AFTER UPDATE ON workspace_files BEGIN
      INSERT INTO workspace_file_index(workspace_file_index, rowid, workspace_id, path, filename)
      VALUES ('delete', old.id, old.workspace_id, old.path, old.filename);
      INSERT INTO workspace_file_index(rowid, workspace_id, path, filename)
      VALUES (new.id, new.workspace_id, new.path, new.filename);
    END;

    CREATE TABLE workspace_file_index_meta (
      workspace_id     TEXT PRIMARY KEY,
      indexed_at       INTEGER NOT NULL,
      root_path        TEXT NOT NULL,
      status           TEXT NOT NULL
        CHECK (status IN ('complete', 'stale', 'truncated')),
      file_count       INTEGER NOT NULL,
      truncate_reason  TEXT
        CHECK (truncate_reason IS NULL OR truncate_reason IN ('maxEntries', 'timeBudget'))
    );
  `);
}
