import type { DatabaseSync } from 'node:sqlite';

export const FILE_SEARCH_SCHEMA_VERSION = 2;

const controlTablesSql = `
  CREATE TABLE IF NOT EXISTS registered_roots (
    id INTEGER PRIMARY KEY,
    root_key TEXT NOT NULL,
    root_path TEXT NOT NULL,
    current_generation INTEGER,

    UNIQUE (root_key),
    CHECK (length(root_key) > 0),
    CHECK (length(root_path) > 0),
    CHECK (current_generation >= 1)
  ) STRICT;
`;

const dropIndexSql = `
  DROP TRIGGER IF EXISTS file_paths_after_insert;
  DROP TRIGGER IF EXISTS file_paths_after_delete;
  DROP TRIGGER IF EXISTS file_paths_after_update;
  DROP TRIGGER IF EXISTS path_entries_after_insert;
  DROP TRIGGER IF EXISTS path_entries_after_delete;
  DROP TRIGGER IF EXISTS path_entries_after_update;
  DROP TABLE IF EXISTS file_paths_fts;
  DROP TABLE IF EXISTS file_paths;
  DROP TABLE IF EXISTS path_entries_fts;
  DROP TABLE IF EXISTS path_entries;
`;

const pathEntriesTableSql = `
  CREATE TABLE path_entries (
    id INTEGER PRIMARY KEY,
    root_id INTEGER NOT NULL,
    generation INTEGER NOT NULL,
    relative_path TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,

    FOREIGN KEY (root_id) REFERENCES registered_roots(id) ON DELETE CASCADE,
    UNIQUE (root_id, generation, relative_path),
    CHECK (generation >= 1),
    CHECK (length(relative_path) > 0),
    CHECK (length(name) > 0),
    CHECK (kind IN ('file', 'directory'))
  ) STRICT;
`;

const ftsTableSql = `
  CREATE VIRTUAL TABLE path_entries_fts USING fts5(
    root_id UNINDEXED,
    generation UNINDEXED,
    kind UNINDEXED,
    relative_path,
    name,
    content = 'path_entries',
    content_rowid = 'id',
    tokenize = 'trigram case_sensitive 0'
  );
`;

const ftsTriggersSql = `
  CREATE TRIGGER path_entries_after_insert AFTER INSERT ON path_entries BEGIN
    INSERT INTO path_entries_fts(rowid, root_id, generation, kind, relative_path, name)
    VALUES (new.id, new.root_id, new.generation, new.kind, new.relative_path, new.name);
  END;

  CREATE TRIGGER path_entries_after_delete AFTER DELETE ON path_entries BEGIN
    INSERT INTO path_entries_fts(
      path_entries_fts, rowid, root_id, generation, kind, relative_path, name
    )
    VALUES (
      'delete', old.id, old.root_id, old.generation, old.kind, old.relative_path, old.name
    );
  END;

  CREATE TRIGGER path_entries_after_update AFTER UPDATE ON path_entries BEGIN
    INSERT INTO path_entries_fts(
      path_entries_fts, rowid, root_id, generation, kind, relative_path, name
    )
    VALUES (
      'delete', old.id, old.root_id, old.generation, old.kind, old.relative_path, old.name
    );

    INSERT INTO path_entries_fts(rowid, root_id, generation, kind, relative_path, name)
    VALUES (new.id, new.root_id, new.generation, new.kind, new.relative_path, new.name);
  END;
`;

export function initializeFileSearchSchema(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE');

  try {
    const version = readSchemaVersion(database);
    if (version > FILE_SEARCH_SCHEMA_VERSION) {
      throw new Error(
        `File-search database schema ${version} is newer than supported schema ` +
          FILE_SEARCH_SCHEMA_VERSION
      );
    }

    if (version < FILE_SEARCH_SCHEMA_VERSION) {
      database.exec(controlTablesSql);
      database.exec(dropIndexSql);
      database.exec(pathEntriesTableSql);
      database.exec(ftsTableSql);
      database.exec(ftsTriggersSql);
      database.exec('UPDATE registered_roots SET current_generation = NULL');
      database.exec(`PRAGMA user_version = ${FILE_SEARCH_SCHEMA_VERSION}`);
    }

    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function readSchemaVersion(database: DatabaseSync): number {
  const row = database.prepare('PRAGMA user_version').get() as { user_version: number };
  return row.user_version;
}
