import { basename, dirname, extname, join } from 'node:path';

export function workspaceRuntimePaths(appDatabasePath: string): {
  stateDirectory: string;
} {
  const extension = extname(appDatabasePath);
  const databaseBasename = basename(appDatabasePath, extension);
  const stateDirectory = join(dirname(appDatabasePath), `${databaseBasename}-workspaces`);
  return { stateDirectory };
}
