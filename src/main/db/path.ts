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
  const { realpathSync } = require('fs');
  const appPath = app.getAppPath();
  const resourcesPath = process.resourcesPath ?? appPath;

  // Resolve symlinks to get actual paths (handles Homebrew, symlinks, etc.)
  const resolveRealPath = (p: string): string | null => {
    try {
      return realpathSync(p);
    } catch {
      return null;
    }
  };

  // Get the executable directory (handles more cases)
  const exePath = app.getPath('exe');
  const exeDir = dirname(exePath);

  const candidates = [
    // Standard Electron paths
    join(appPath, 'drizzle'),
    join(appPath, '..', 'drizzle'),
    join(resourcesPath, 'drizzle'),

    // Handle ASAR unpacked
    join(resourcesPath, 'app.asar.unpacked', 'drizzle'),

    // Handle Homebrew and other symlinked installations
    ...(resolveRealPath(appPath)
      ? [
          join(resolveRealPath(appPath)!, 'drizzle'),
          join(resolveRealPath(appPath)!, '..', 'drizzle'),
        ]
      : []),

    // Handle macOS app bundle structure
    join(exeDir, '..', 'Resources', 'drizzle'),
    join(exeDir, '..', 'Resources', 'app', 'drizzle'),
    join(exeDir, '..', 'Resources', 'app.asar.unpacked', 'drizzle'),

    // Development paths
    join(process.cwd(), 'drizzle'),
    join(__dirname, '..', '..', '..', 'drizzle'),

    // Handle translocated apps on macOS
    ...(process.platform === 'darwin' && appPath.includes('AppTranslocation')
      ? [join(appPath.split('AppTranslocation')[0], 'drizzle')]
      : []),
  ];

  // Remove duplicates and try each candidate
  const uniqueCandidates = [...new Set(candidates.filter(Boolean))];

  for (const candidate of uniqueCandidates) {
    if (existsSync(candidate)) {
      // Verify it's actually a directory with migration files
      try {
        const files = require('fs').readdirSync(candidate);
        if (files.some((f: string) => f.endsWith('.sql'))) {
          console.log(`Found migrations at: ${candidate}`);
          return candidate;
        }
      } catch {
        // Not a valid directory, continue
      }
    }
  }

  // Log diagnostic information to help debug
  console.error('Failed to find drizzle migrations folder. Searched paths:');
  console.error('- appPath:', appPath);
  console.error('- resourcesPath:', resourcesPath);
  console.error('- exeDir:', exeDir);
  console.error('- cwd:', process.cwd());
  console.error('- __dirname:', __dirname);
  console.error('- Candidates checked:', uniqueCandidates);

  return null;
}
