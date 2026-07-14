import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { FILE_SEARCH_SCHEMA_VERSION, initializeFileSearchSchema } from './schema';

describe('initializeFileSearchSchema', () => {
  it('creates the schema idempotently', () => {
    using database = createDatabase();

    initializeFileSearchSchema(database);
    initializeFileSearchSchema(database);

    const objects = database
      .prepare(
        `SELECT name
         FROM sqlite_schema
         WHERE name IN (
           'registered_roots',
           'path_entries',
           'path_entries_fts',
           'path_entries_after_insert',
           'path_entries_after_delete',
           'path_entries_after_update'
         )
         ORDER BY name`
      )
      .all() as Array<{ name: string }>;

    expect(objects.map(({ name }) => name)).toEqual([
      'path_entries',
      'path_entries_after_delete',
      'path_entries_after_insert',
      'path_entries_after_update',
      'path_entries_fts',
      'registered_roots',
    ]);

    const rootColumns = database.prepare('PRAGMA table_info(registered_roots)').all() as Array<{
      name: string;
    }>;
    const entryColumns = database.prepare('PRAGMA table_info(path_entries)').all() as Array<{
      name: string;
    }>;
    const version = database.prepare('PRAGMA user_version').get() as { user_version: number };

    expect(rootColumns.map(({ name }) => name)).toEqual([
      'id',
      'root_key',
      'root_path',
      'current_generation',
    ]);
    expect(entryColumns.map(({ name }) => name)).toEqual([
      'id',
      'root_id',
      'generation',
      'relative_path',
      'name',
      'kind',
    ]);
    expect(version.user_version).toBe(FILE_SEARCH_SCHEMA_VERSION);
  });

  it('keeps the FTS index synchronized with file and directory path changes', () => {
    using database = createDatabase();
    initializeFileSearchSchema(database);
    const rootId = insertRoot(database);

    const inserted = database
      .prepare(
        `INSERT INTO path_entries (root_id, generation, relative_path, name, kind)
         VALUES (?, 1, ?, ?, ?)`
      )
      .run(rootId, 'src/index.ts', 'index.ts', 'file');
    database
      .prepare(
        `INSERT INTO path_entries (root_id, generation, relative_path, name, kind)
         VALUES (?, 1, ?, ?, ?)`
      )
      .run(rootId, 'src/components', 'components', 'directory');

    expect(search(database, 'index')).toEqual([{ path: 'src/index.ts', kind: 'file' }]);
    expect(search(database, 'components')).toEqual([{ path: 'src/components', kind: 'directory' }]);

    database
      .prepare(`UPDATE path_entries SET relative_path = ?, name = ? WHERE id = ?`)
      .run('src/main.ts', 'main.ts', inserted.lastInsertRowid);

    expect(search(database, 'index')).toEqual([]);
    expect(search(database, 'main')).toEqual([{ path: 'src/main.ts', kind: 'file' }]);

    database.prepare('DELETE FROM path_entries WHERE id = ?').run(inserted.lastInsertRowid);

    expect(search(database, 'main')).toEqual([]);

    database
      .prepare(
        `INSERT INTO path_entries (root_id, generation, relative_path, name, kind)
         VALUES (?, 1, ?, ?, ?)`
      )
      .run(rootId, 'src/worker.ts', 'worker.ts', 'file');
    database.prepare('DELETE FROM registered_roots WHERE id = ?').run(rootId);

    expect(search(database, 'worker')).toEqual([]);
  });

  it('rejects unsupported path-entry kinds', () => {
    using database = createDatabase();
    initializeFileSearchSchema(database);
    const rootId = insertRoot(database);

    expect(() =>
      database
        .prepare(
          `INSERT INTO path_entries (root_id, generation, relative_path, name, kind)
           VALUES (?, 1, ?, ?, ?)`
        )
        .run(rootId, 'src/link', 'link', 'symlink')
    ).toThrow();
  });

  it('rebuilds version-one file indexes without losing registered roots', () => {
    using database = createDatabase();
    createVersionOneSchema(database);

    initializeFileSearchSchema(database);

    const root = database
      .prepare(`SELECT root_key, root_path, current_generation FROM registered_roots`)
      .get() as {
      root_key: string;
      root_path: string;
      current_generation: number | null;
    };
    const version = database.prepare('PRAGMA user_version').get() as { user_version: number };
    const entryCount = database.prepare('SELECT count(*) AS count FROM path_entries').get() as {
      count: number;
    };
    const legacyTable = database
      .prepare(`SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'file_paths'`)
      .get();

    expect(root).toMatchObject({
      root_key: '/workspace',
      root_path: '/workspace',
      current_generation: null,
    });
    expect(version.user_version).toBe(FILE_SEARCH_SCHEMA_VERSION);
    expect(entryCount.count).toBe(0);
    expect(legacyTable).toBeUndefined();
  });

  it('rejects a database created by a newer schema version', () => {
    using database = createDatabase();
    database.exec(`PRAGMA user_version = ${FILE_SEARCH_SCHEMA_VERSION + 1}`);

    expect(() => initializeFileSearchSchema(database)).toThrow('newer than supported');
  });
});

function createDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  return database;
}

function insertRoot(database: DatabaseSync, currentGeneration: number | null = null): number {
  const result = database
    .prepare(
      `INSERT INTO registered_roots (root_key, root_path, current_generation)
       VALUES (?, ?, ?)`
    )
    .run('/workspace', '/workspace', currentGeneration);

  return Number(result.lastInsertRowid);
}

function search(database: DatabaseSync, query: string): Array<{ path: string; kind: string }> {
  const rows = database
    .prepare(
      `SELECT relative_path, kind
       FROM path_entries_fts
       WHERE path_entries_fts MATCH ?
       ORDER BY relative_path`
    )
    .all(query) as Array<{ relative_path: string; kind: string }>;

  return rows.map(({ relative_path, kind }) => ({ path: relative_path, kind }));
}

function createVersionOneSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE registered_roots (
      id INTEGER PRIMARY KEY,
      root_key TEXT NOT NULL UNIQUE,
      root_path TEXT NOT NULL,
      current_generation INTEGER
    ) STRICT;

    CREATE TABLE file_paths (
      id INTEGER PRIMARY KEY,
      root_id INTEGER NOT NULL,
      generation INTEGER NOT NULL,
      relative_path TEXT NOT NULL,
      filename TEXT NOT NULL,
      FOREIGN KEY (root_id) REFERENCES registered_roots(id) ON DELETE CASCADE
    ) STRICT;

    CREATE VIRTUAL TABLE file_paths_fts USING fts5(
      root_id UNINDEXED,
      generation UNINDEXED,
      relative_path,
      filename,
      content = 'file_paths',
      content_rowid = 'id',
      tokenize = 'trigram case_sensitive 0'
    );

    INSERT INTO registered_roots (id, root_key, root_path, current_generation)
    VALUES (1, '/workspace', '/workspace', 1);

    INSERT INTO file_paths (root_id, generation, relative_path, filename)
    VALUES (1, 1, 'src/index.ts', 'index.ts');

    PRAGMA user_version = 1;
  `);
}
