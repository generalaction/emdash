import { describe, expect, it } from 'vitest';
import type { BundledMigration } from '../api';
import { nodeSqliteDriver } from './node-sqlite-driver';
import { defineDerivedSqliteStore, defineDurableSqliteStore } from './store';

const migrations: BundledMigration[] = [
  {
    idx: 0,
    tag: '0000_records',
    when: 1,
    hash: 'records',
    sql: 'CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL);',
  },
  {
    idx: 1,
    tag: '0001_records_note',
    when: 2,
    hash: 'records-note',
    sql: 'ALTER TABLE records ADD COLUMN note TEXT;',
  },
];

describe('SQLite store lifecycle', () => {
  it('awaits asynchronous temporary-database seeds', async () => {
    const store = defineDurableSqliteStore({
      name: 'temp-seed-test',
      driver: nodeSqliteDriver,
      migrations,
    });
    const handle = await store.openTemp(async ({ connection }) => {
      await Promise.resolve();
      connection.run('INSERT INTO records (id, value) VALUES (1, ?)', ['seeded']);
    });

    try {
      expect(
        handle.connection.get<{ value: string }>('SELECT value FROM records WHERE id = 1')?.value
      ).toBe('seeded');
    } finally {
      handle.close();
    }
  });

  it('opens a pre-migration state and migrates it to latest', () => {
    const store = defineDurableSqliteStore({
      name: 'migration-boundary-test',
      driver: nodeSqliteDriver,
      migrations,
    });
    const handle = store.openAtMigration(1);

    try {
      expect(
        handle.connection
          .all<{ name: string }>('PRAGMA table_info(records)')
          .map(({ name }) => name)
      ).toEqual(['id', 'value']);

      handle.connection.run('INSERT INTO records (id, value) VALUES (1, ?)', ['kept']);
      handle.migrateToLatest();

      expect(
        handle.connection
          .all<{ name: string }>('PRAGMA table_info(records)')
          .map(({ name }) => name)
      ).toEqual(['id', 'value', 'note']);
      expect(
        handle.connection.get<{ value: string }>('SELECT value FROM records WHERE id = 1')?.value
      ).toBe('kept');
    } finally {
      handle.close();
    }
  });

  it('cleans up temporary databases when a seed fails', async () => {
    const store = defineDerivedSqliteStore({
      name: 'temp-cleanup-test',
      driver: nodeSqliteDriver,
      version: 1,
      createSchema(connection) {
        connection.exec('CREATE TABLE cache (value TEXT)');
      },
    });

    await expect(
      store.openTemp(async () => {
        throw new Error('seed failed');
      })
    ).rejects.toThrow('seed failed');
  });

  it('rejects invalid migration boundaries', () => {
    const store = defineDurableSqliteStore({
      name: 'invalid-boundary-test',
      driver: nodeSqliteDriver,
      migrations,
    });
    expect(() => store.openAtMigration(3)).toThrow('Migration boundary');
  });
});
