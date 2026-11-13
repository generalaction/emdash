import type { SqliteConnection, SynchronousResult } from '../api';

export function inTransaction<T>(
  connection: SqliteConnection,
  operation: () => SynchronousResult<T>
): T {
  connection.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    if (result instanceof Promise) {
      throw new TypeError('SQLite store transactions must be synchronous');
    }
    connection.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      connection.exec('ROLLBACK');
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'SQLite transaction rollback failed');
    }
    throw error;
  }
}
