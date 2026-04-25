import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { resolveDatabasePath } from './path';
import * as schema from './schema';

export type AppDb = ReturnType<typeof drizzle<typeof schema>>;

export const sqlite = new Database(resolveDatabasePath());
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000');

export const db = drizzle(sqlite, { schema });
