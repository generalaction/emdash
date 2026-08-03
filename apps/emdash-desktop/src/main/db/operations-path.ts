import { resolve } from 'node:path';
import { resolveDatabasePath } from './path';

export function resolveOperationsDatabasePath(): string {
  const explicit = process.env.EMDASH_OPERATIONS_DB_FILE?.trim();
  if (explicit) {
    return resolve(explicit);
  }

  const appDbPath = resolveDatabasePath();
  return appDbPath.endsWith('.db')
    ? appDbPath.replace(/\.db$/, '-operations.db')
    : `${appDbPath}-operations.db`;
}
