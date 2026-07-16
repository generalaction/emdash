import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Logger } from '../../lib/api/logger';
import type { SqliteConnection } from '../api';

export function quoteSqliteString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function listBackups(databasePath: string): string[] {
  const directory = dirname(databasePath);
  const prefix = `${basename(databasePath)}.backup-`;
  return readdirSync(directory)
    .filter((entry) => entry.startsWith(prefix))
    .map((entry) => join(directory, entry))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
}

export function createBackup(
  connection: SqliteConnection,
  databasePath: string,
  retain: number,
  logger: Logger
): string {
  if (!Number.isSafeInteger(retain) || retain < 1) {
    throw new RangeError(`Backup retention must be a positive integer, received ${retain}`);
  }

  const backupPath = `${databasePath}.backup-${Date.now()}-${randomUUID()}`;
  connection.exec(`VACUUM INTO ${quoteSqliteString(backupPath)}`);
  logger.info('Created SQLite store backup', { databasePath, backupPath });

  for (const stalePath of listBackups(databasePath).slice(retain)) {
    rmSync(stalePath, { force: true });
  }
  return backupPath;
}

export function restoreLatestBackup(databasePath: string, logger: Logger): string {
  const backupPath = listBackups(databasePath)[0];
  if (!backupPath) {
    throw new Error(`No SQLite store backup exists for ${databasePath}`);
  }

  const temporaryPath = `${databasePath}.restore-${randomUUID()}.tmp`;
  const previousPath = `${databasePath}.restore-previous`;
  copyFileSync(backupPath, temporaryPath);
  rmSync(previousPath, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });

  let movedPrevious = false;
  try {
    if (existsSync(databasePath)) {
      renameSync(databasePath, previousPath);
      movedPrevious = true;
    }
    renameSync(temporaryPath, databasePath);
    rmSync(previousPath, { force: true });
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    if (movedPrevious && !existsSync(databasePath)) {
      renameSync(previousPath, databasePath);
    }
    throw error;
  }

  logger.info('Restored SQLite store backup', { databasePath, backupPath });
  return backupPath;
}
