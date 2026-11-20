import { sql } from 'drizzle-orm';
import type { AppDb } from './db';

export type DatabaseSpace = {
  /** Bytes held by the main database file (page_count × page_size). */
  fileBytes: number;
  /** Bytes in free pages that a VACUUM would return to the filesystem. */
  freeBytes: number;
};

/** Reads page accounting for the main database; cheap, no I/O beyond the header. */
export function getDatabaseSpace(db: AppDb): DatabaseSpace {
  const pageSize = readPragma(db, 'page_size');
  return {
    fileBytes: readPragma(db, 'page_count') * pageSize,
    freeBytes: readPragma(db, 'freelist_count') * pageSize,
  };
}

let compacting = false;

/**
 * Rebuilds the main database file to drop its free pages, then truncates the WAL so
 * the freed space reaches the filesystem. VACUUM cannot run inside a transaction and
 * holds an exclusive lock for its duration; better-sqlite3 runs it synchronously, so
 * the calling process blocks until it finishes. Returns the bytes freed.
 */
export function compactDatabase(db: AppDb): number {
  if (compacting) throw new Error('Database compaction is already running.');
  compacting = true;
  try {
    const before = getDatabaseSpace(db).fileBytes;
    db.run(sql`VACUUM`);
    db.run(sql`PRAGMA wal_checkpoint(TRUNCATE)`);
    const after = getDatabaseSpace(db).fileBytes;
    return Math.max(0, before - after);
  } finally {
    compacting = false;
  }
}

function readPragma(db: AppDb, name: 'page_size' | 'page_count' | 'freelist_count'): number {
  const row = db.get<Record<string, unknown>>(sql.raw(`PRAGMA ${name}`));
  const value = row ? Object.values(row)[0] : undefined;
  return typeof value === 'number' ? value : Number(value ?? 0);
}
