import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { dropFileIndexSchema } from './file-index-schema';
import { initializeDatabase } from './initialize';

let sqlite: Database.Database | undefined;

describe('ensureFileIndex', () => {
  afterEach(() => {
    sqlite?.close();
    sqlite = undefined;
  });

  it('creates the v5 file index schema on a fresh database', async () => {
    sqlite = await initializeDatabase(new Database(':memory:'));

    expect(schemaNames(sqlite, 'table')).toEqual(
      expect.arrayContaining([
        'workspace_files',
        'workspace_file_index',
        'workspace_file_index_meta',
      ])
    );
    expect(schemaNames(sqlite, 'trigger')).toEqual(
      expect.arrayContaining(['workspace_files_ai', 'workspace_files_ad', 'workspace_files_au'])
    );
    expect(fileIndexVersion(sqlite)).toBe('5');
  });

  it('upgrades a populated v4 file index to v5', async () => {
    sqlite = await initializeDatabase(new Database(':memory:'));

    // Recreate the historical v4 shape: content-owning FTS5, no content table.
    dropFileIndexSchema(sqlite);
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
        root_path        TEXT NOT NULL,
        status           TEXT NOT NULL,
        file_count       INTEGER NOT NULL,
        truncate_reason  TEXT
      );
    `);
    sqlite
      .prepare(`INSERT INTO workspace_file_index(workspace_id, path, filename) VALUES (?, ?, ?)`)
      .run('ws-1', '/repo/a.ts', 'a.ts');
    sqlite
      .prepare(
        `INSERT INTO workspace_file_index_meta
         (workspace_id, indexed_at, root_path, status, file_count, truncate_reason)
         VALUES ('ws-1', unixepoch(), '/repo', 'complete', 1, NULL)`
      )
      .run();
    sqlite.prepare(`UPDATE kv SET value = '4' WHERE key = 'file_index_version'`).run();

    await initializeDatabase(sqlite);

    expect(fileIndexVersion(sqlite)).toBe('5');
    expect(schemaNames(sqlite, 'table')).toEqual(expect.arrayContaining(['workspace_files']));
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM workspace_files`).get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM workspace_file_index_meta`).get()).toEqual(
      { count: 0 }
    );
  });

  it('preserves indexed rows when the version already matches', async () => {
    sqlite = await initializeDatabase(new Database(':memory:'));
    sqlite
      .prepare(`INSERT INTO workspace_files(workspace_id, path, filename) VALUES (?, ?, ?)`)
      .run('ws-1', '/repo/a.ts', 'a.ts');

    await initializeDatabase(sqlite);

    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM workspace_files`).get()).toEqual({
      count: 1,
    });
  });
});

function schemaNames(sqlite: Database.Database, type: 'table' | 'trigger'): string[] {
  return (
    sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = ?`).all(type) as Array<{
      name: string;
    }>
  ).map((row) => row.name);
}

function fileIndexVersion(sqlite: Database.Database): string | undefined {
  const row = sqlite.prepare(`SELECT value FROM kv WHERE key = 'file_index_version'`).get() as
    | { value: string }
    | undefined;
  return row?.value;
}
