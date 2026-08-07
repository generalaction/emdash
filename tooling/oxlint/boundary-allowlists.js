import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_REPO_ROOT = path.resolve(currentDir, '../..');
export const DEFAULT_BOUNDARY_ALLOWLIST_PATH = path.join(
  currentDir,
  'allowlists/core-boundaries.json'
);
export const DEFAULT_API_SURFACE_ALLOWLIST_PATH = path.join(
  currentDir,
  'allowlists/api-surfaces.json'
);

const EMPTY_ALLOWLISTS = Object.freeze({
  coreToHost: [],
  mainCoreToFeatures: [],
  crossSlice: [],
  tsxInApi: [],
});

function normalizePath(value) {
  return value.replaceAll('\\', '/');
}

function normalizeEntry(entry, repoRoot) {
  return normalizePath(
    path.isAbsolute(entry) ? path.resolve(entry) : path.resolve(repoRoot, entry)
  );
}

/**
 * When set, boundary rules report allowlisted violations too. The allowlist
 * ratchet (tooling/oxlint/scripts/check-allowlists.mjs) uses this to compare
 * the full violation set against the allowlist files.
 */
export function isBoundaryAllowlistingDisabled(env = process.env) {
  return env.EMDASH_DISABLE_BOUNDARY_ALLOWLISTS === '1';
}

export function loadBoundaryAllowlists(allowlistPath = DEFAULT_BOUNDARY_ALLOWLIST_PATH) {
  if (isBoundaryAllowlistingDisabled()) return EMPTY_ALLOWLISTS;
  try {
    const parsed = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
    return {
      coreToHost: Array.isArray(parsed.coreToHost) ? parsed.coreToHost : [],
      mainCoreToFeatures: Array.isArray(parsed.mainCoreToFeatures) ? parsed.mainCoreToFeatures : [],
      crossSlice: Array.isArray(parsed.crossSlice) ? parsed.crossSlice : [],
      tsxInApi: Array.isArray(parsed.tsxInApi) ? parsed.tsxInApi : [],
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return EMPTY_ALLOWLISTS;
    throw error;
  }
}

export function isBoundaryFileAllowlisted(filename, entries, repoRoot = DEFAULT_REPO_ROOT) {
  if (!filename || !Array.isArray(entries) || entries.length === 0) return false;
  const normalizedFilename = normalizePath(path.resolve(filename));
  return entries.some((entry) => normalizeEntry(entry, repoRoot) === normalizedFilename);
}
