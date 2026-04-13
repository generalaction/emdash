import { join, resolve } from 'node:path';
import { app } from 'electron';
import { CURRENT_DB_FILENAME } from './default-path';

export interface ResolveDatabasePathOptions {
  userDataPath?: string;
}

export function resolveDatabasePath(options: ResolveDatabasePathOptions = {}): string {
  const explicitDbFile = process.env.EMDASH_DB_FILE?.trim();
  if (explicitDbFile) {
    return resolve(explicitDbFile);
  }

  const userDataPath = options.userDataPath ?? app.getPath('userData');
  return join(userDataPath, CURRENT_DB_FILENAME);
}

export const databaseFilenames = {
  current: CURRENT_DB_FILENAME,
};
