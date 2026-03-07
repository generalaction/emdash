import { existsSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { app } from 'electron';

const CURRENT_DB_FILENAME = 'emdash2.db';
const LEGACY_DB_FILENAMES = ['database.sqlite', 'orcbench.db'];

export interface ResolveDatabasePathOptions {
  userDataPath?: string;
}

export function resolveDatabasePath(options: ResolveDatabasePathOptions = {}): string {
  const explicitDbFile = process.env.EMDASH_DB_FILE?.trim();
  if (explicitDbFile) {
    return resolve(explicitDbFile);
  }

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
