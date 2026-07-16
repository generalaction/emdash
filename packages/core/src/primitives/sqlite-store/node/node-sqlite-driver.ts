import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';
import type { SqliteConnection, SqliteDriver } from '../api';

function bind(params: readonly unknown[]): SQLInputValue[] {
  return [...params] as SQLInputValue[];
}

function normalizeRow<T>(row: unknown): T {
  return { ...(row as Record<string, unknown>) } as T;
}

export const nodeSqliteDriver: SqliteDriver = {
  open(path) {
    const database = new DatabaseSync(path);
    const connection: SqliteConnection = {
      native: database,
      exec: (sql) => database.exec(sql),
      get: <T>(sql: string, params: readonly unknown[] = []) => {
        const row = database.prepare(sql).get(...bind(params));
        return row === undefined ? undefined : normalizeRow<T>(row);
      },
      all: <T>(sql: string, params: readonly unknown[] = []) =>
        database
          .prepare(sql)
          .all(...bind(params))
          .map((row) => normalizeRow<T>(row)),
      run: (sql, params = []) => database.prepare(sql).run(...bind(params)),
      close: () => database.close(),
    };
    return connection;
  },
};
