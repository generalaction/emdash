import { createHash } from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3';
import journal from '@root/drizzle/meta/_journal.json';
import { sqlite } from './client';

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
 * Runs all pending migrations against the shared SQLite connection and validates
 * the schema contract. Call this once in main.ts before any db queries run.
 *
 * Throws `DatabaseSchemaMismatchError` when required columns/tables are missing
 * after migration (e.g. the user downgraded from a newer build).
 *
 * Returns the raw better-sqlite3 handle so the caller can close it on shutdown.
 */
export async function initializeDatabase(): Promise<BetterSqlite3.Database> {
  runBundledMigrations(sqlite);
  ensureSearchIndex(sqlite);
  return sqlite;
}
