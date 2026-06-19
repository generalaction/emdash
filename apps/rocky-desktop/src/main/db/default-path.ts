import { homedir } from 'node:os';
import { join } from 'node:path';
import { USER_DATA_DIR_NAME } from '@shared/app-identity';

export const CURRENT_DB_FILENAME = 'rocky.db';

/**
 * Returns the platform-specific default userData directory without requiring
 * the Electron `app` module. Imports USER_DATA_DIR_NAME from app-identity so
 * the drizzle-kit CLI resolves the same directory as the running app.
 *
 * Pass this result as `userDataPath` to `resolveDatabasePath()` when running
 * outside of Electron (e.g. drizzle-kit CLI).
 */
export function resolveDefaultUserDataPath(): string {
  const home = process.env.HOME ?? homedir();
  const platform = process.platform;

  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', USER_DATA_DIR_NAME);
  }

  if (platform === 'win32') {
    const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
    return join(appData, USER_DATA_DIR_NAME);
  }

  const xdgConfig = process.env.XDG_CONFIG_HOME ?? join(home, '.config');
  return join(xdgConfig, USER_DATA_DIR_NAME);
}

/**
 * Returns the default database file path given a resolved userData directory.
 * Does not check for file existence or perform any migration — suitable for
 * contexts that only need a path (e.g. drizzle-kit config).
 */
export function defaultDbFilePath(userDataPath: string): string {
  return join(userDataPath, CURRENT_DB_FILENAME);
}
