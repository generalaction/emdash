import { openFixture, type FixtureDb } from '@tooling/utils/db';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppDb } from './db';
import { kv } from './schema';

describe('AppDb transactions', () => {
  let fixture: FixtureDb | undefined;

  afterEach(() => {
    fixture?.close();
    fixture = undefined;
  });

  it('rejects async callbacks and rolls back their synchronous part', async () => {
    fixture = await openFixture('empty');
    const db: AppDb = fixture.db;

    /* oxlint-disable emdash/no-async-transaction-callback -- the async callback is the case under test */
    expect(() =>
      // @ts-expect-error transaction callbacks must be synchronous
      db.transaction(async (tx) => {
        tx.insert(kv).values({ key: 'before-await', value: '1' }).run();
        await Promise.resolve();
      })
    ).toThrow('Transaction function cannot return a promise');
    /* oxlint-enable emdash/no-async-transaction-callback */
    expect(fixture.sqlite.prepare(`SELECT 1 FROM kv WHERE key = 'before-await'`).get()).toBe(
      undefined
    );
  });

  it('holds nested transactions to the synchronous contract at compile time', () => {
    // Type-checked only: drizzle's nested savepoint does not reject a promise at runtime.
    /* oxlint-disable emdash/no-async-transaction-callback -- the async callback is the case under test */
    const nestedAsync = (db: AppDb) =>
      db.transaction((tx) =>
        tx.transaction((savepoint) =>
          // @ts-expect-error nested transaction callbacks must be synchronous
          savepoint.transaction(async () => {})
        )
      );
    /* oxlint-enable emdash/no-async-transaction-callback */
    expect(nestedAsync).toBeTypeOf('function');
  });
});
