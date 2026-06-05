import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './client.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
export function runMigrations() {
    const db = getDb();
    const migrationsFolder = join(__dirname, '../../drizzle');
    migrate(db, { migrationsFolder });
}
