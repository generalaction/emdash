import { basename, dirname, extname, join } from 'node:path';
import { resolveDatabasePath } from '@main/db/path';

export function automationRuntimePaths(): {
  dbFile: string;
  stateDirectory: string;
} {
  const appDatabasePath = resolveDatabasePath();
  const extension = extname(appDatabasePath);
  const databaseBasename = basename(appDatabasePath, extension);
  const stateDirectory = join(dirname(appDatabasePath), `${databaseBasename}-automations`);
  return {
    dbFile: join(dirname(appDatabasePath), `${databaseBasename}-automations${extension || '.db'}`),
    stateDirectory,
  };
}
