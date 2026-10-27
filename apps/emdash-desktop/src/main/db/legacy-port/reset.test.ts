import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { listUserTables } from './reset';

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
