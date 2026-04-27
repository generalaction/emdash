import type Database from 'better-sqlite3';
import { clearDestinationDataPreservingSignIn, quoteIdentifier, tableExists } from './reset';

const COPY_TABLE_ORDER = [
  'app_settings',
  'pull_request_users',
  'pull_requests',
  'pull_request_labels',
  'pull_request_assignees',
  'pull_request_checks',
  'ssh_connections',
  'projects',
  'project_remotes',
  'tasks',
  'conversations',
  'terminals',
  'messages',
  'editor_buffers',
] as const;

function quoteSqliteString(value: string): string {
  return `'${value.split("'").join("''")}'`;
}

function attachedTableExists(sqlite: Database.Database, tableName: string): boolean {
  const row = sqlite
    .prepare(`SELECT 1 FROM beta.sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
    .get(tableName);
  return Boolean(row);
}

function columnsForTable(
  sqlite: Database.Database,
  schemaName: 'main' | 'beta',
  tableName: string
): string[] {
  const rows = sqlite
    .prepare(`PRAGMA ${schemaName}.table_info(${quoteIdentifier(tableName)})`)
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function copyTable(sqlite: Database.Database, tableName: string): void {
  if (!tableExists(sqlite, tableName) || !attachedTableExists(sqlite, tableName)) return;

  const destinationColumns = new Set(columnsForTable(sqlite, 'main', tableName));
  const sourceColumns = columnsForTable(sqlite, 'beta', tableName);
  const columns = sourceColumns.filter((column) => destinationColumns.has(column));
  if (columns.length === 0) return;

  const columnSql = columns.map(quoteIdentifier).join(', ');
  const quotedTable = quoteIdentifier(tableName);
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO ${quotedTable} (${columnSql}) SELECT ${columnSql} FROM beta.${quotedTable}`
    )
    .run();
}

export function importBetaDatabaseIntoDestination(
  sqlite: Database.Database,
  betaDatabasePath: string
): void {
  const foreignKeys = sqlite.pragma('foreign_keys', { simple: true }) as number;
  sqlite.pragma('foreign_keys = OFF');
  sqlite.exec(`ATTACH DATABASE ${quoteSqliteString(betaDatabasePath)} AS beta`);

  try {
    const copy = sqlite.transaction(() => {
      clearDestinationDataPreservingSignIn(sqlite);
      for (const tableName of COPY_TABLE_ORDER) {
        copyTable(sqlite, tableName);
      }
    });
    copy();
  } finally {
    sqlite.exec('DETACH DATABASE beta');
    sqlite.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
  }
}
