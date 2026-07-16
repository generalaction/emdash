import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BundledMigration } from '../api';
import { drizzleV0Interop } from './drizzle-v0-interop';
import { nodeSqliteDriver } from './node-sqlite-driver';
import { defineDurableSqliteStore } from './store';

const migration: BundledMigration = {
  idx: 0,
  tag: '0000_users',
  when: 1234,
  hash: 'users-hash',
  sql: 'CREATE TABLE users (id INTEGER PRIMARY KEY);',
};

function tempPath(): string {
  return join(tmpdir(), `sqlite-store-drizzle-v0-${randomUUID()}.db`);
}

function cleanup(path: string): void {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true });
}

function createLegacyDatabase(path: string, hash: string, when: number): void {
  const connection = nodeSqliteDriver.open(path);
  connection.exec(`
    CREATE TABLE __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at NUMERIC
    );
    CREATE TABLE users (id INTEGER PRIMARY KEY);
  `);
  connection.run('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)', [hash, when]);
  connection.close();
}

describe('drizzle v0 migration interop', () => {
  it('backfills by journal timestamp', () => {
    const path = tempPath();
    createLegacyDatabase(path, migration.hash, migration.when);
    const store = defineDurableSqliteStore({
      name: 'legacy-test',
      driver: nodeSqliteDriver,
      migrations: [migration],
      interop: drizzleV0Interop,
    });

    try {
      const handle = store.open(path);
      expect(
        handle.connection.get<{ tag: string }>('SELECT tag FROM __emdash_migrations')?.tag
      ).toBe(migration.tag);
      handle.close();
    } finally {
      cleanup(path);
    }
  });

  it('falls back to hash when the journal timestamp does not match', () => {
    const path = tempPath();
    createLegacyDatabase(path, migration.hash, 9999);
    const store = defineDurableSqliteStore({
      name: 'legacy-hash-test',
      driver: nodeSqliteDriver,
      migrations: [migration],
      interop: drizzleV0Interop,
    });

    try {
      const handle = store.open(path);
      expect(
        handle.connection.get<{ tag: string }>('SELECT tag FROM __emdash_migrations')?.tag
      ).toBe(migration.tag);
      handle.close();
    } finally {
      cleanup(path);
    }
  });

  it('throws when an applied legacy migration cannot be identified', () => {
    const path = tempPath();
    createLegacyDatabase(path, 'unknown-hash', 9999);
    const store = defineDurableSqliteStore({
      name: 'legacy-invalid-test',
      driver: nodeSqliteDriver,
      migrations: [migration],
      interop: drizzleV0Interop,
    });

    try {
      expect(() => store.open(path)).toThrow('Unrecognized legacy migration');
    } finally {
      cleanup(path);
    }
  });

  it('dual-writes new migrations in temporary databases', async () => {
    const store = defineDurableSqliteStore({
      name: 'legacy-dual-write-test',
      driver: nodeSqliteDriver,
      migrations: [migration],
      interop: drizzleV0Interop,
    });
    const handle = await store.openTemp();

    try {
      expect(
        handle.connection.get<{ hash: string; created_at: number }>(
          'SELECT hash, created_at FROM __drizzle_migrations'
        )
      ).toEqual({ hash: migration.hash, created_at: migration.when });
    } finally {
      handle.close();
    }
  });
});
