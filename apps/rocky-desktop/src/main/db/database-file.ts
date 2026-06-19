import fs from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { CURRENT_DB_FILENAME } from './default-path';

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

export function resolveDefaultDatabasePath(userDataPath: string): string {
  fs.mkdirSync(userDataPath, { recursive: true });
  return join(userDataPath, CURRENT_DB_FILENAME);
}
