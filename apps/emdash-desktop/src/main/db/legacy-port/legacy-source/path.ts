import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { PREVIOUS_DB_FILENAME } from '@main/db/default-path';

type Platform = NodeJS.Platform;

export function resolveLegacyUserDataPathCandidates(
  userDataPath: string,
  platform: Platform = process.platform
): string[] {
  const candidates = [userDataPath];

  if (platform === 'linux' && basename(userDataPath) === 'emdash') {
    candidates.push(join(dirname(userDataPath), 'Emdash'));
  }

  return candidates;
}

export function resolveLegacyDatabasePath(userDataPath: string): string {
  return join(userDataPath, 'emdash.db');
}

export function resolveExistingLegacyUserDataPath(userDataPath: string): string {
  return (
    resolveLegacyUserDataPathCandidates(userDataPath).find((candidate) =>
      existsSync(resolveLegacyDatabasePath(candidate))
    ) ?? userDataPath
  );
}

export function resolveExistingLegacyDatabasePath(userDataPath: string): string {
  return resolveLegacyDatabasePath(resolveExistingLegacyUserDataPath(userDataPath));
}

export function hasLegacyDatabaseFile(userDataPath: string): boolean {
  return resolveLegacyUserDataPathCandidates(userDataPath).some((candidate) =>
    existsSync(resolveLegacyDatabasePath(candidate))
  );
}

export function resolveBetaDatabasePath(userDataPath: string) {
  return join(userDataPath, PREVIOUS_DB_FILENAME);
}

export function resolveExistingBetaDatabasePath(userDataPath: string): string {
  return (
    resolveLegacyUserDataPathCandidates(userDataPath)
      .map(resolveBetaDatabasePath)
      .find((candidate) => existsSync(candidate)) ?? resolveBetaDatabasePath(userDataPath)
  );
}

export function hasBetaDatabaseFile(userDataPath: string): boolean {
  return resolveLegacyUserDataPathCandidates(userDataPath).some((candidate) =>
    existsSync(resolveBetaDatabasePath(candidate))
  );
}
