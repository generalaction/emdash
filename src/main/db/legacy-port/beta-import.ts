import type Database from 'better-sqlite3';
import { clearDestinationDataPreservingSignIn } from './reset';
import {
  columnsForTable,
  quoteIdentifier,
  quoteSqliteString,
  tableExists,
  withForeignKeysDisabled,
} from './sqlite-utils';

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

function copyTable(sqlite: Database.Database, tableName: string): void {
  if (!tableExists(sqlite, tableName) || !tableExists(sqlite, tableName, 'beta')) return;

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
  withForeignKeysDisabled(sqlite, () => {
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
    }
  });
}
