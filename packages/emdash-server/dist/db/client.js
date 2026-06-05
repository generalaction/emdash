import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as schema from './schema.js';
let _db = null;
export function getDb() {
    if (!_db)
        throw new Error('DB not initialized. Call initDb() first.');
    return _db;
}
export function initDb(dbPath) {
    if (dbPath !== ':memory:')
        mkdirSync(dirname(dbPath), { recursive: true });
    const sqlite = new Database(dbPath);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('busy_timeout = 5000');
    _db = drizzle(sqlite, { schema });
    return _db;
}
