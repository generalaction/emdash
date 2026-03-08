import { join } from 'node:path';
import { homedir } from 'node:os';

export const CURRENT_DB_FILENAME = 'emdash2.db';
export const LEGACY_DB_FILENAMES = ['database.sqlite', 'orcbench.db'];

/**
 * Returns the platform-specific default userData directory for Emdash without
 * requiring the Electron `app` module. Matches what `app.getPath('userData')`
 * returns in a packaged build (productName = "Emdash").
 *
 * Pass this result as `userDataPath` to `resolveDatabasePath()` when running
 * outside of Electron (e.g. drizzle-kit CLI).
 */
export function resolveDefaultUserDataPath(): string {
  const home = process.env.HOME ?? homedir();
  const platform = process.platform;

  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Emdash');
  }

  if (platform === 'win32') {
    const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
    return join(appData, 'Emdash');
  }

  const xdgConfig = process.env.XDG_CONFIG_HOME ?? join(home, '.config');
  return join(xdgConfig, 'Emdash');
}

/**
 * Returns the default database file path given a resolved userData directory.
 * Does not check for file existence or perform any migration — suitable for
 * contexts that only need a path (e.g. drizzle-kit config).
 */
export function defaultDbFilePath(userDataPath: string): string {
  return join(userDataPath, CURRENT_DB_FILENAME);
}
