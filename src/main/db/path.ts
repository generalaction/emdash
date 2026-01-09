import { existsSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import { app } from 'electron';

const CURRENT_DB_FILENAME = 'emdash.db';
const LEGACY_DB_FILENAMES = ['database.sqlite', 'orcbench.db'];

export interface ResolveDatabasePathOptions {
  userDataPath?: string;
}

export function resolveDatabasePath(options: ResolveDatabasePathOptions = {}): string {
  const userDataPath = options.userDataPath ?? app.getPath('userData');

  const currentPath = join(userDataPath, CURRENT_DB_FILENAME);
  if (existsSync(currentPath)) {
    return currentPath;
  }

  // Dev safety: prior versions sometimes resolved userData under the default Electron app
  // (e.g. ~/Library/Application Support/Electron).
  try {
    const userDataParent = dirname(userDataPath);
    const legacyDirs = ['Electron', 'emdash', 'Emdash'];
    for (const dirName of legacyDirs) {
      const candidateDir = join(userDataParent, dirName);
      const candidateCurrent = join(candidateDir, CURRENT_DB_FILENAME);
      if (existsSync(candidateCurrent)) {
        try {
          renameSync(candidateCurrent, currentPath);
          return currentPath;
        } catch {
          return candidateCurrent;
        }
      }
    }
  } catch {
    // best-effort only
  }

  for (const legacyName of LEGACY_DB_FILENAMES) {
    const legacyPath = join(userDataPath, legacyName);
    if (existsSync(legacyPath)) {
      try {
        renameSync(legacyPath, currentPath);
        return currentPath;
      } catch {
        return legacyPath;
      }
    }
  }

  return currentPath;
}

export const databaseFilenames = {
  current: CURRENT_DB_FILENAME,
  legacy: [...LEGACY_DB_FILENAMES],
};

export function resolveMigrationsPath(): string | null {
  const appPath = app.getAppPath();
  const resourcesPath = process.resourcesPath ?? appPath;
  const candidates = [
    join(appPath, 'drizzle'),
    join(appPath, '..', 'drizzle'),
    join(resourcesPath, 'drizzle'),
    join(process.cwd(), 'drizzle'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}
