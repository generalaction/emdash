import assert from 'node:assert/strict';
import type { SqliteDriver } from '../api';

/**
 * Runs the driver behaviors required by the store primitive.
 *
 * The caller owns cleanup of `path`. Keeping this independent of a test runner
 * lets consumers reuse it without adding Vitest as a runtime dependency.
 */
export function runSqliteDriverConformance(driver: SqliteDriver, path: string): void {
  const connection = driver.open(path);
  try {
    connection.exec(`
      CREATE TABLE conformance_values (
        id INTEGER PRIMARY KEY,
        text_value TEXT,
        integer_value INTEGER,
        blob_value BLOB,
        null_value TEXT
      );
      CREATE INDEX conformance_text_idx ON conformance_values(text_value);
    `);

    const inserted = connection.run(
      `INSERT INTO conformance_values
       (id, text_value, integer_value, blob_value, null_value)
       VALUES (?, ?, ?, ?, ?)`,
      [1, 'hello', Number.MAX_SAFE_INTEGER, new Uint8Array([1, 2, 3]), null]
    );
    assert.equal(inserted.changes, 1);

    const row = connection.get<{
      blob_value: Uint8Array;
      id: number;
      integer_value: number;
      null_value: null;
      text_value: string;
    }>(
      `SELECT id, text_value, integer_value, blob_value, null_value
       FROM conformance_values
       WHERE id = ?`,
      [1]
    );
    assert.ok(row);
    assert.equal(row.id, 1);
    assert.equal(row.text_value, 'hello');
    assert.equal(row.integer_value, Number.MAX_SAFE_INTEGER);
    assert.deepEqual([...row.blob_value], [1, 2, 3]);
    assert.equal(row.null_value, null);
    assert.deepEqual(
      connection.all<{ id: number }>('SELECT id FROM conformance_values ORDER BY id'),
      [{ id: 1 }]
    );
  } finally {
    connection.close();
  }
}
