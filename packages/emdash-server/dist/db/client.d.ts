import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
export type ServerDb = ReturnType<typeof drizzle<typeof schema>>;
export declare function getDb(): ServerDb;
export declare function initDb(dbPath: string): ServerDb;
