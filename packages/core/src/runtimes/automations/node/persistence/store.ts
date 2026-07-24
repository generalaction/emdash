import type { DurableSqliteStore } from '@primitives/sqlite-store/api';
import { betterSqlite3Driver, defineDurableSqliteStore } from '@primitives/sqlite-store/node';
import { assertSqliteStoreInvariants } from '@primitives/sqlite-store/testing';
import type Database from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrations } from './migrations/migrations.generated';
import * as schema from './schema';

export type AutomationsDb = BetterSQLite3Database<typeof schema>;

export const automationsStore: DurableSqliteStore<AutomationsDb, Database.Database> =
  defineDurableSqliteStore({
    name: 'automations',
    driver: betterSqlite3Driver,
    migrations,
    createOrm: (connection) => drizzle(connection.native, { schema }),
    backup: { retain: 2 },
    invariants: [assertSqliteStoreInvariants],
  });
