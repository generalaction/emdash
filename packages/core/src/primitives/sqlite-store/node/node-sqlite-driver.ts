import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import type { SqliteConnection, SqliteDriver } from '../api';

function bind(params: readonly unknown[]): SQLInputValue[] {
  return [...params] as SQLInputValue[];
}

function normalizeRow<T>(row: unknown): T {
  return Object.fromEntries(
    Object.entries(row as Record<string, unknown>).map(([key, value]) => [
      key,
      typeof value === 'bigint' &&
      value >= BigInt(Number.MIN_SAFE_INTEGER) &&
      value <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(value)
        : value,
    ])
  ) as T;
}

function prepare(database: DatabaseSync, sql: string): StatementSync {
  const statement = database.prepare(sql);
  statement.setReadBigInts(true);
  return statement;
}

export const nodeSqliteDriver: SqliteDriver = {
  open(path) {
    const database = new DatabaseSync(path);
    const connection: SqliteConnection = {
      native: database,
      exec: (sql) => database.exec(sql),
      get: <T>(sql: string, params: readonly unknown[] = []) => {
        const row = prepare(database, sql).get(...bind(params));
        return row === undefined ? undefined : normalizeRow<T>(row);
      },
      all: <T>(sql: string, params: readonly unknown[] = []) =>
        prepare(database, sql)
          .all(...bind(params))
          .map((row) => normalizeRow<T>(row)),
      run: (sql, params = []) => prepare(database, sql).run(...bind(params)),
      close: () => database.close(),
    };
    return connection;
  },
};
