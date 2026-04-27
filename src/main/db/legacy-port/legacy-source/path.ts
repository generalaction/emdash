import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PREVIOUS_DB_FILENAME } from '@main/db/default-path';

export function resolveLegacyDatabasePath(userDataPath: string): string {
  return join(userDataPath, 'emdash.db');
}

export function hasLegacyDatabaseFile(userDataPath: string): boolean {
  return existsSync(resolveLegacyDatabasePath(userDataPath));
}

export function hasBetaDatabaseFile(userDataPath: string): boolean {
  return existsSync(join(userDataPath, PREVIOUS_DB_FILENAME));
}
