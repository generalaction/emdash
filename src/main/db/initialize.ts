import { createHash } from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3';
import journal from '@root/drizzle/meta/_journal.json';

// Vite bundles all migration SQL files at build time — no runtime path resolution needed.
// Each value is the raw SQL string content of the file.
const sqlFiles = import.meta.glob('@root/drizzle/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

type JournalEntry = { idx: number; when: number; tag: string; breakpoints: boolean };

function runBundledMigrations(connection: BetterSqlite3.Database): void {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at NUMERIC
    )
  `);

  const appliedHashes = new Set(
    (connection.prepare('SELECT hash FROM __drizzle_migrations').all() as { hash: string }[]).map(
      (r) => r.hash
    )
  );

  connection.transaction(() => {
    for (const entry of (journal as { entries: JournalEntry[] }).entries) {
      const sqlKey = Object.keys(sqlFiles).find((k) => k.includes(entry.tag));
      if (!sqlKey) throw new Error(`Missing bundled SQL for migration: ${entry.tag}`);

      const sql = sqlFiles[sqlKey];
      const hash = createHash('sha256').update(sql).digest('hex');
      if (appliedHashes.has(hash)) continue;

      for (const stmt of sql.split('--> statement-breakpoint')) {
        const trimmed = stmt.trim();
        if (trimmed) connection.exec(trimmed);
      }

      connection
        .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
        .run(hash, entry.when);
    }
  })();
}

/**
 * Creates the FTS5 full-text search virtual table used by the command palette.
 * This is managed outside the Drizzle migration system because Drizzle cannot
 * generate FTS5 virtual table DDL. The table is version-gated via the `kv`
 * table so it can be safely dropped and recreated when the schema changes.
 */
function ensureSearchIndex(connection: BetterSqlite3.Database): void {
  // Bump this version string whenever the FTS schema changes — the table is
  // dropped and recreated, and backfill() + seedCommands() repopulate it.
  const SEARCH_INDEX_VERSION = '3';

  const row = connection.prepare(`SELECT value FROM kv WHERE key = 'fts_version'`).get() as
    | { value: string }
    | undefined;

  if (row?.value !== SEARCH_INDEX_VERSION) {
    connection.exec(`DROP TABLE IF EXISTS search_index`);
    connection.exec(`
      CREATE VIRTUAL TABLE search_index USING fts5(
        item_type,
        item_id    UNINDEXED,
        project_id UNINDEXED,
        task_id    UNINDEXED,
        title,
        keywords,
        tokenize = 'trigram case_sensitive 0'
      )
    `);
    connection
      .prepare(
        `INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES ('fts_version', ?, unixepoch())`
      )
      .run(SEARCH_INDEX_VERSION);
  }
}

/**
 * Creates the FTS5 virtual table and companion meta table used for workspace
 * file indexing. Managed outside Drizzle (same reason as ensureSearchIndex).
 * Version-gated via `kv` so the tables can be dropped and recreated on schema
 * changes without a full Drizzle migration.
 */
function ensureFileIndex(connection: BetterSqlite3.Database): void {
  const FILE_INDEX_VERSION = '1';

  const row = connection.prepare(`SELECT value FROM kv WHERE key = 'file_index_version'`).get() as
    | { value: string }
    | undefined;

  if (row?.value === FILE_INDEX_VERSION) return;

  connection.exec(`DROP TABLE IF EXISTS workspace_file_index`);
  connection.exec(`DROP TABLE IF EXISTS workspace_file_index_meta`);
  connection.exec(`
    CREATE VIRTUAL TABLE workspace_file_index USING fts5(
      workspace_id UNINDEXED,
      path,
      filename,
      tokenize = 'trigram case_sensitive 0'
    )
  `);
  connection.exec(`
    CREATE TABLE workspace_file_index_meta (
      workspace_id TEXT PRIMARY KEY,
      indexed_at   INTEGER NOT NULL
    )
  `);
  connection
    .prepare(
      `INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES ('file_index_version', ?, unixepoch())`
    )
    .run(FILE_INDEX_VERSION);
}

/**
 * Runs all pending migrations against the provided SQLite connection (or the
 * app's shared singleton when called without arguments). Call this once in
 * main.ts before any db queries run.
 *
 * Accepts an explicit connection so migration tests and fixture generators can
 * pass an in-memory database without pulling in the Electron-dependent client
 * module at import time.
 *
 * Returns the connection that was used.
 */
export async function initializeDatabase(
  connection?: BetterSqlite3.Database
): Promise<BetterSqlite3.Database> {
  // Lazily import the app singleton only when no explicit connection is given.
  // This keeps the module importable in non-Electron environments (Vitest).
  const conn = connection ?? (await import('./client')).sqlite;
  runBundledMigrations(conn);
  ensureSearchIndex(conn);
  ensureFileIndex(conn);
  return conn;
}
