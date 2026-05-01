import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ARTIFACT_PREFIX, RELEASE_DIR, UPDATE_CHANNEL } from './config.ts';

function matchFiles(pattern: RegExp): string[] {
  try {
    return readdirSync(RELEASE_DIR)
      .filter((f) => pattern.test(f))
      .map((f) => join(RELEASE_DIR, f));
  } catch {
    return [];
  }
}

export function findManifests(channel = UPDATE_CHANNEL): string[] {
  return matchFiles(new RegExp(`^${channel}.*\\.yml$`));
}

export function findInstallers(prefix = ARTIFACT_PREFIX): string[] {
  return matchFiles(new RegExp(`^${prefix}-.*\\.(dmg|zip|exe|msi|AppImage|deb|rpm)$`));
}

export function findBlockmaps(): string[] {
  return matchFiles(/\.blockmap$/);
}

export function findArtifacts(patterns: string[]): string[] {
  const combined = new RegExp(patterns.map((p) => `(?:${p})`).join('|'));
  return matchFiles(combined);
}
