import type { Logger } from '../../lib/api/logger';
import type { SqliteConnection, SqliteDriver } from './driver';

export type BundledMigration = {
  idx: number;
  tag: string;
  /** Legacy Drizzle journal timestamp in milliseconds. */
  when: number;
  /** SHA-256 of the raw migration SQL bytes. */
  hash: string;
  sql: string;
};

export type AppliedMigration = {
  tag: string;
  hash: string;
};

export interface MigrationInterop {
  /** Called once inside the runner bootstrap transaction. */
  backfill?(connection: SqliteConnection, migrations: readonly BundledMigration[]): void;
  /** Called inside the same transaction that records an applied migration. */
  onApplied?(connection: SqliteConnection, migration: BundledMigration): void;
}

export type StoreHandle<TDb> = {
  readonly db: TDb;
  readonly connection: SqliteConnection;
  /** Transactions are synchronous; the callback must not return a promise. */
  transaction<T>(operation: () => T): T;
  close(): void;
};

export type TempStoreHandle<TDb> = StoreHandle<TDb> & {
  readonly path: string;
};

export type TempMigrationHandle<TDb> = TempStoreHandle<TDb> & {
  migrateToLatest(): void;
};

type BaseStoreConfig<TDb> = {
  name: string;
  driver: SqliteDriver;
  createOrm?: (connection: SqliteConnection) => TDb;
  busyTimeoutMs?: number;
  logger?: Logger;
};

export type DurableStoreConfig<TDb = SqliteConnection> = BaseStoreConfig<TDb> & {
  migrations: readonly BundledMigration[];
  interop?: MigrationInterop;
  backup?: {
    retain: number;
  };
  postMigrate?: readonly ((connection: SqliteConnection) => void)[];
  invariants?: readonly ((connection: SqliteConnection) => void)[];
};

export type DerivedStoreConfig<TDb = SqliteConnection> = BaseStoreConfig<TDb> & {
  version: number;
  createSchema(connection: SqliteConnection): void;
};

export interface SqliteStoreBase<TDb> {
  open(path: string): StoreHandle<TDb>;
  openTemp(
    seed?: (handle: StoreHandle<TDb>) => void | Promise<void>
  ): Promise<TempStoreHandle<TDb>>;
}

export interface DurableSqliteStore<TDb> extends SqliteStoreBase<TDb> {
  openAtMigration(uptoIdx: number): TempMigrationHandle<TDb>;
  restoreLatestBackup(path: string): void;
}

export type DerivedSqliteStore<TDb> = SqliteStoreBase<TDb>;
