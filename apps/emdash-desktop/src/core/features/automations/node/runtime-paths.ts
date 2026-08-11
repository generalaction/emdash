import { basename, dirname, extname, join } from 'node:path';

export function automationRuntimePaths(appDatabasePath: string): {
  dbFile: string;
} {
  const extension = extname(appDatabasePath);
  const databaseBasename = basename(appDatabasePath, extension);
  return {
    dbFile: join(dirname(appDatabasePath), `${databaseBasename}-automations${extension || '.db'}`),
  };
}
