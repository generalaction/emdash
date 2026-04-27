import type Database from 'better-sqlite3';

export const PRESERVED_SECRET_KEYS = ['emdash-account-token', 'emdash-github-token'] as const;
export const PRESERVED_KV_KEYS = ['account:profile', 'github:tokenSource'] as const;

export function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function placeholders(values: readonly string[]): string {
  return values.map(() => '?').join(', ');
}

export function tableExists(sqlite: Database.Database, tableName: string): boolean {
  const row = sqlite
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
    .get(tableName);
  return Boolean(row);
}

export function listUserTables(sqlite: Database.Database): string[] {
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

  return rows.map((row) => row.name);
}

export function clearDestinationDataPreservingSignIn(sqlite: Database.Database): void {
  const foreignKeys = sqlite.pragma('foreign_keys', { simple: true }) as number;
  sqlite.pragma('foreign_keys = OFF');

  try {
    const tables = listUserTables(sqlite);
    const clear = sqlite.transaction(() => {
      for (const table of tables) {
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
    });

    clear();
  } finally {
    sqlite.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
  }
}
