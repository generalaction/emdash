import { resolve } from 'node:path';
import { app } from 'electron';
import { assertUserDataConfigured } from '@main/bootstrap/app-paths-guard';
import { resolveDefaultDatabasePath } from './database-file';
import { CURRENT_DB_FILENAME, PREVIOUS_DB_FILENAME } from './default-path';

export interface ResolveDatabasePathOptions {
  userDataPath?: string;
}

export function resolveDatabasePath(options: ResolveDatabasePathOptions = {}): string {
  const explicitDbFile = process.env.EMDASH_DB_FILE?.trim();
  if (explicitDbFile) {
    return resolve(explicitDbFile);
  }

  if (options.userDataPath) return resolveDefaultDatabasePath(options.userDataPath);
  assertUserDataConfigured();
  return resolveDefaultDatabasePath(app.getPath('userData'));
}

export const databaseFilenames = {
  current: CURRENT_DB_FILENAME,
  previous: PREVIOUS_DB_FILENAME,
};
