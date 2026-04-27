import type Database from 'better-sqlite3';

export function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

export function quoteSqliteString(value: string): string {
  return `'${value.split("'").join("''")}'`;
}

export function tableExists(
  sqlite: Database.Database,
  tableName: string,
  schemaName: 'main' | 'beta' = 'main'
): boolean {
  const row = sqlite
    .prepare(`SELECT 1 FROM ${schemaName}.sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
    .get(tableName);
  return Boolean(row);
}

export function columnsForTable(
  sqlite: Database.Database,
  schemaName: 'main' | 'beta',
  tableName: string
): string[] {
  const rows = sqlite
    .prepare(`PRAGMA ${schemaName}.table_info(${quoteIdentifier(tableName)})`)
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

export function withForeignKeysDisabled<T>(sqlite: Database.Database, action: () => T): T {
  const foreignKeys = sqlite.pragma('foreign_keys', { simple: true }) as number;
  sqlite.pragma('foreign_keys = OFF');

  try {
    return action();
  } finally {
    sqlite.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
  }
}

export function withForeignKeysEnabled<T>(sqlite: Database.Database, action: () => T): T {
  const foreignKeys = sqlite.pragma('foreign_keys', { simple: true }) as number;
  sqlite.pragma('foreign_keys = ON');

  try {
    return action();
  } finally {
    sqlite.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
  }
}
