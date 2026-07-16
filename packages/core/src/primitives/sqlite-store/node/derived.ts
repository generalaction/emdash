import type { Logger } from '../../lib/api/logger';
import type { DerivedStoreConfig, SqliteConnection } from '../api';
import { inTransaction } from './transaction';

type SchemaObject = {
  name: string;
  sql: string | null;
  type: 'table' | 'trigger' | 'view';
};

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function clearDerivedSchema(connection: SqliteConnection): void {
  const objects = connection.all<SchemaObject>(
    `SELECT type, name, sql
     FROM sqlite_schema
     WHERE type IN ('table', 'trigger', 'view')
       AND name NOT LIKE 'sqlite_%'`
  );
  const dropOrder: SchemaObject['type'][] = ['trigger', 'view', 'table'];

  for (const type of dropOrder) {
    const matching = objects
      .filter((object) => object.type === type)
      .sort((left, right) => {
        const leftVirtual = left.sql?.startsWith('CREATE VIRTUAL TABLE') ? 1 : 0;
        const rightVirtual = right.sql?.startsWith('CREATE VIRTUAL TABLE') ? 1 : 0;
        return rightVirtual - leftVirtual;
      });
    for (const object of matching) {
      connection.exec(`DROP ${type.toUpperCase()} IF EXISTS ${quoteIdentifier(object.name)}`);
    }
  }
}

export function ensureDerivedSchema<TDb>(
  connection: SqliteConnection,
  config: DerivedStoreConfig<TDb>,
  logger: Logger
): void {
  if (!Number.isSafeInteger(config.version) || config.version < 1) {
    throw new RangeError(`Derived store version must be a positive integer: ${config.version}`);
  }

  const row = connection.get<{ user_version: number }>('PRAGMA user_version');
  const currentVersion = row?.user_version ?? 0;
  if (currentVersion === config.version) return;

  connection.exec('PRAGMA foreign_keys = OFF');
  try {
    inTransaction(connection, () => {
      clearDerivedSchema(connection);
      config.createSchema(connection);
      connection.exec(`PRAGMA user_version = ${config.version}`);
    });
  } finally {
    connection.exec('PRAGMA foreign_keys = ON');
  }

  logger.info('Rebuilt derived SQLite store schema', {
    name: config.name,
    fromVersion: currentVersion,
    toVersion: config.version,
  });
}
