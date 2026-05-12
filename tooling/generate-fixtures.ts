/**
 * Generates committed fixture databases for migration testing.
 *
 * Usage:
 *   pnpm run db:fixtures
 *
 * Runs via Vitest so that import.meta.glob (used by initializeDatabase) and
 * @main/ path aliases are resolved correctly — matching the exact migration
 * runner the production app uses.
 *
 * Each entry in `seeds` produces a corresponding .db file committed under
 * tooling/fixtures/. Run this script whenever the schema changes (after
 * `pnpm run db:generate`) to keep the fixtures in sync.
 *
 * Note: better-sqlite3 must be compiled for system Node (not Electron).
 * On a fresh `pnpm install` this is the default. If you have previously run
 * `pnpm run rebuild` for Electron dev, rebuild for Node first:
 *   npm rebuild better-sqlite3
 * Then regenerate fixtures, then run `pnpm run rebuild` again for the app.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, describe, it } from 'vitest';
import { initializeDatabase } from '@main/db/initialize';
import * as schema from '@main/db/schema';
import { seeds } from '@tooling/seeds/index';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, 'fixtures');

describe('generate fixtures', () => {
  const connections: Database.Database[] = [];

  afterAll(() => {
    for (const sqlite of connections) {
      if (sqlite.open) sqlite.close();
    }
  });

  for (const [name, seed] of Object.entries(seeds)) {
    it(`writes tooling/fixtures/${name}.db`, async () => {
      const out = path.join(fixturesDir, `${name}.db`);

      for (const suffix of ['', '-wal', '-shm']) {
        fs.rmSync(`${out}${suffix}`, { force: true });
      }

      const sqlite = new Database(out);
      connections.push(sqlite);
      sqlite.pragma('journal_mode = WAL');
      sqlite.pragma('busy_timeout = 5000');

      // Use our own migration runner — same code path as the production app —
      // so any bugs in initializeDatabase() are caught here too.
      await initializeDatabase(sqlite);

      const db = drizzle(sqlite, { schema });
      await seed(db);

      // Checkpoint WAL so all data lands in the main file.
      sqlite.pragma('wal_checkpoint(TRUNCATE)');
      sqlite.close();
      connections.splice(connections.indexOf(sqlite), 1);

      console.log(`wrote ${path.relative(process.cwd(), out)}`);
    });
  }
});
