import type { DatabaseSync } from 'node:sqlite';

export const FILE_SEARCH_SCHEMA_VERSION = 1;

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
  DROP TABLE IF EXISTS file_paths_fts;
  DROP TABLE IF EXISTS file_paths;
`;

const filePathsTableSql = `
  CREATE TABLE file_paths (
    id INTEGER PRIMARY KEY,
    root_id INTEGER NOT NULL,
    generation INTEGER NOT NULL,
    relative_path TEXT NOT NULL,
    filename TEXT NOT NULL,

    FOREIGN KEY (root_id) REFERENCES registered_roots(id) ON DELETE CASCADE,
    UNIQUE (root_id, generation, relative_path),
    CHECK (generation >= 1),
    CHECK (length(relative_path) > 0),
    CHECK (length(filename) > 0)
  ) STRICT;
`;

const ftsTableSql = `
  CREATE VIRTUAL TABLE file_paths_fts USING fts5(
    root_id UNINDEXED,
    generation UNINDEXED,
    relative_path,
    filename,
    content = 'file_paths',
    content_rowid = 'id',
    tokenize = 'trigram case_sensitive 0'
  );
`;

const ftsTriggersSql = `
  CREATE TRIGGER file_paths_after_insert AFTER INSERT ON file_paths BEGIN
    INSERT INTO file_paths_fts(rowid, root_id, generation, relative_path, filename)
    VALUES (new.id, new.root_id, new.generation, new.relative_path, new.filename);
  END;

  CREATE TRIGGER file_paths_after_delete AFTER DELETE ON file_paths BEGIN
    INSERT INTO file_paths_fts(
      file_paths_fts, rowid, root_id, generation, relative_path, filename
    )
    VALUES ('delete', old.id, old.root_id, old.generation, old.relative_path, old.filename);
  END;

  CREATE TRIGGER file_paths_after_update AFTER UPDATE ON file_paths BEGIN
    INSERT INTO file_paths_fts(
      file_paths_fts, rowid, root_id, generation, relative_path, filename
    )
    VALUES ('delete', old.id, old.root_id, old.generation, old.relative_path, old.filename);

    INSERT INTO file_paths_fts(rowid, root_id, generation, relative_path, filename)
    VALUES (new.id, new.root_id, new.generation, new.relative_path, new.filename);
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
      database.exec(filePathsTableSql);
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
