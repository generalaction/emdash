import { basename, dirname, extname, join } from 'node:path';
import { resolveDatabasePath } from '@main/db/path';

export function workspaceRuntimePaths(): {
  stateDirectory: string;
  worktreePoolPath: string;
} {
  const appDatabasePath = resolveDatabasePath();
  const extension = extname(appDatabasePath);
  const databaseBasename = basename(appDatabasePath, extension);
  const stateDirectory = join(dirname(appDatabasePath), `${databaseBasename}-workspaces`);
  return {
    stateDirectory,
    worktreePoolPath: join(stateDirectory, 'worktrees'),
  };
}
