import type Database from 'better-sqlite3';
import { createFileIndexSchema, FILE_INDEX_TABLES } from '../file-index-schema';
import { quoteIdentifier, tableExists, withForeignKeysDisabled } from './sqlite-utils';

export const PRESERVED_SECRET_KEYS = ['emdash-account-token', 'emdash-github-token'] as const;
export const PRESERVED_KV_KEYS = ['account:profile', 'github:tokenSource'] as const;

function placeholders(values: readonly string[]): string {
  return values.map(() => '?').join(', ');
}

function listShadowTables(sqlite: Database.Database): Set<string> {
  const rows = sqlite.prepare(`PRAGMA table_list`).all() as Array<{ name: string; type: string }>;

  return new Set(rows.filter((row) => row.type === 'shadow').map((row) => row.name));
}

export function listUserTables(sqlite: Database.Database): string[] {
  const shadowTables = listShadowTables(sqlite);
  const rows = sqlite
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
          AND name != '__drizzle_migrations'
      `
    )
    .all() as Array<{ name: string }>;

  return rows.map((row) => row.name).filter((name) => !shadowTables.has(name));
}

export function clearDestinationDataPreservingSignIn(sqlite: Database.Database): void {
  withForeignKeysDisabled(sqlite, () => {
    const tables = listUserTables(sqlite);
    const fileIndexTables = new Set<string>(FILE_INDEX_TABLES);
    const hasFileIndex = tables.some((table) => fileIndexTables.has(table));
    const clear = sqlite.transaction(() => {
      for (const table of tables) {
        // The file index is an external-content FTS5 table synced by triggers:
        // a plain DELETE on the virtual table followed by trigger-fired FTS
        // 'delete' commands corrupts the index. Drop and recreate it instead.
        if (fileIndexTables.has(table)) continue;

        if (table === 'app_secrets' && tableExists(sqlite, 'app_secrets')) {
          sqlite
            .prepare(
              `DELETE FROM ${quoteIdentifier(table)} WHERE key NOT IN (${placeholders(PRESERVED_SECRET_KEYS)})`
            )
            .run(...PRESERVED_SECRET_KEYS);
          continue;
        }

        if (table === 'kv' && tableExists(sqlite, 'kv')) {
          sqlite
            .prepare(
              `DELETE FROM ${quoteIdentifier(table)} WHERE key NOT IN (${placeholders(PRESERVED_KV_KEYS)})`
            )
            .run(...PRESERVED_KV_KEYS);
          continue;
        }

        sqlite.prepare(`DELETE FROM ${quoteIdentifier(table)}`).run();
      }

      if (hasFileIndex) createFileIndexSchema(sqlite);
    });

    clear();
  });
}
