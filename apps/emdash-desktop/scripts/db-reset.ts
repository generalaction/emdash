import { rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Cross-platform replacement for the old `rm -f` db:reset scripts, which only ran
// on POSIX shells. Wipes the dev SQLite databases (and their -wal/-shm sidecars)
// from the platform-specific userData directory.
const DEV_DIR_NAME = 'emdash-dev';
const DB_BASENAMES = ['emdash3.db', 'emdash4.db'];

function devUserDataDir(): string {
  const home = process.env.HOME ?? homedir();

  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', DEV_DIR_NAME);
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
    return join(appData, DEV_DIR_NAME);
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME ?? join(home, '.config');
  return join(xdgConfig, DEV_DIR_NAME);
}

const dir = devUserDataDir();
for (const base of DB_BASENAMES) {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(join(dir, `${base}${suffix}`), { force: true });
  }
}

console.log(`db:reset: cleared dev databases in ${dir}`);
