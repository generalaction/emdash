import { existsSync, renameSync } from 'fs';
import { join } from 'path';
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
