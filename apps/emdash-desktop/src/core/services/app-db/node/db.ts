import type { SynchronousResult } from '@emdash/core/primitives/sqlite-store/api';
import type { drizzle } from 'drizzle-orm/better-sqlite3';
import type { SQLiteTransactionConfig } from 'drizzle-orm/sqlite-core';
import type * as schema from './schema';

type DrizzleAppDb = ReturnType<typeof drizzle<typeof schema>>;
type DrizzleNativeTx = Parameters<Parameters<DrizzleAppDb['transaction']>[0]>[0];

/** A transaction whose nested `transaction` (a savepoint) keeps the synchronous contract. */
export type DrizzleTx = Omit<DrizzleNativeTx, 'transaction'> & {
  transaction<T>(transaction: (tx: DrizzleTx) => SynchronousResult<T>): T;
};

/**
 * The shared app database. better-sqlite3 transactions are synchronous, so `transaction`
 * callbacks may not return a promise: work after an `await` would run outside the transaction.
 * The `emdash/no-async-transaction-callback` lint rule also rejects `async` callbacks whose
 * result type is forced to `void`, which this type cannot see.
 */
export type AppDb = Omit<DrizzleAppDb, 'transaction'> & {
  transaction<T>(
    transaction: (tx: DrizzleTx) => SynchronousResult<T>,
    config?: SQLiteTransactionConfig
  ): T;
};
