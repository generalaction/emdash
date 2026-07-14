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
           'file_paths',
           'file_paths_fts',
           'file_paths_after_insert',
           'file_paths_after_delete',
           'file_paths_after_update'
         )
         ORDER BY name`
      )
      .all() as Array<{ name: string }>;

    expect(objects.map(({ name }) => name)).toEqual([
      'file_paths',
      'file_paths_after_delete',
      'file_paths_after_insert',
      'file_paths_after_update',
      'file_paths_fts',
      'registered_roots',
    ]);

    const columns = database.prepare('PRAGMA table_info(registered_roots)').all() as Array<{
      name: string;
    }>;
    const version = database.prepare('PRAGMA user_version').get() as { user_version: number };

    expect(columns.map(({ name }) => name)).toEqual([
      'id',
      'root_key',
      'root_path',
      'current_generation',
    ]);
    expect(version.user_version).toBe(FILE_SEARCH_SCHEMA_VERSION);
  });

  it('keeps the FTS index synchronized with file path changes', () => {
    using database = createDatabase();
    initializeFileSearchSchema(database);
    const rootId = insertRoot(database);

    const inserted = database
      .prepare(
        `INSERT INTO file_paths (root_id, generation, relative_path, filename)
         VALUES (?, 1, ?, ?)`
      )
      .run(rootId, 'src/index.ts', 'index.ts');

    expect(search(database, 'index')).toEqual(['src/index.ts']);

    database
      .prepare(`UPDATE file_paths SET relative_path = ?, filename = ? WHERE id = ?`)
      .run('src/main.ts', 'main.ts', inserted.lastInsertRowid);

    expect(search(database, 'index')).toEqual([]);
    expect(search(database, 'main')).toEqual(['src/main.ts']);

    database.prepare('DELETE FROM file_paths WHERE id = ?').run(inserted.lastInsertRowid);

    expect(search(database, 'main')).toEqual([]);

    database
      .prepare(
        `INSERT INTO file_paths (root_id, generation, relative_path, filename)
         VALUES (?, 1, ?, ?)`
      )
      .run(rootId, 'src/worker.ts', 'worker.ts');
    database.prepare('DELETE FROM registered_roots WHERE id = ?').run(rootId);

    expect(search(database, 'worker')).toEqual([]);
  });

  it('rebuilds disposable index data without losing registered roots', () => {
    using database = createDatabase();
    initializeFileSearchSchema(database);
    const rootId = insertRoot(database, 1);

    database
      .prepare(
        `INSERT INTO file_paths (root_id, generation, relative_path, filename)
         VALUES (?, 1, ?, ?)`
      )
      .run(rootId, 'src/index.ts', 'index.ts');
    database.exec('PRAGMA user_version = 0');

    initializeFileSearchSchema(database);

    const root = database
      .prepare(`SELECT root_key, root_path, current_generation FROM registered_roots`)
      .get() as {
      root_key: string;
      root_path: string;
      current_generation: number | null;
    };
    const version = database.prepare('PRAGMA user_version').get() as { user_version: number };
    const pathCount = database.prepare('SELECT count(*) AS count FROM file_paths').get() as {
      count: number;
    };

    expect(root).toMatchObject({
      root_key: '/workspace',
      root_path: '/workspace',
      current_generation: null,
    });
    expect(version.user_version).toBe(FILE_SEARCH_SCHEMA_VERSION);
    expect(pathCount.count).toBe(0);
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

function search(database: DatabaseSync, query: string): string[] {
  const rows = database
    .prepare(
      `SELECT relative_path
       FROM file_paths_fts
       WHERE file_paths_fts MATCH ?
       ORDER BY relative_path`
    )
    .all(query) as Array<{ relative_path: string }>;

  return rows.map(({ relative_path }) => relative_path);
}
