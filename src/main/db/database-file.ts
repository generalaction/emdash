import fs from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { CURRENT_DB_FILENAME, PREVIOUS_DB_FILENAME } from './default-path';

function quoteSqliteString(value: string): string {
  return `'${value.split("'").join("''")}'`;
}

export function copySqliteDatabase(sourcePath: string, destinationPath: string): void {
  fs.mkdirSync(dirname(destinationPath), { recursive: true });

  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    source.pragma('busy_timeout = 5000');
    source.exec(`VACUUM INTO ${quoteSqliteString(destinationPath)}`);
  } finally {
    source.close();
  }
}

function clearCopiedAppSecrets(databasePath: string): void {
  const copied = new Database(databasePath, { fileMustExist: true });
  try {
    copied.pragma('busy_timeout = 5000');
    const hasAppSecretsTable = copied
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
      .get('app_secrets');
    if (hasAppSecretsTable) {
      copied.exec('DELETE FROM app_secrets');
      // DELETE only marks the pages as free — original secret bytes stay on
      // disk until SQLite reuses the pages. VACUUM rewrites the database so
      // backups, sync clients, and forensic tools can't recover them.
      copied.exec('VACUUM');
    }
  } finally {
    copied.close();
  }
}

export function resolveDefaultDatabasePath(userDataPath: string): string {
  const currentPath = join(userDataPath, CURRENT_DB_FILENAME);
  if (fs.existsSync(currentPath)) {
    return currentPath;
  }

  const previousPath = join(userDataPath, PREVIOUS_DB_FILENAME);
  if (fs.existsSync(previousPath)) {
    // Stage in a temp file so a crash between VACUUM INTO and DELETE FROM
    // app_secrets can't leave the migrated DB sitting at currentPath with the
    // secrets still inside. We only rename after the secrets are gone.
    const stagingPath = `${currentPath}.migrating-${process.pid}-${Date.now()}`;
    try {
      copySqliteDatabase(previousPath, stagingPath);
      clearCopiedAppSecrets(stagingPath);
      fs.renameSync(stagingPath, currentPath);
    } catch (error) {
      try {
        fs.rmSync(stagingPath, { force: true });
      } catch {}
      throw error;
    }
  }

  return currentPath;
}
