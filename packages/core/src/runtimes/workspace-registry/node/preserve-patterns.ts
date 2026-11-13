import { glob } from 'node:fs/promises';
import path from 'node:path';
import { EMDASH_CONFIG_FILE } from '#primitives/emdash-config/api';

export type PreservedEntries = {
  /** Matched entries as checkout-relative POSIX paths, reduced to top-level entries. */
  entries: string[];
  /** Patterns refused because they could reach outside the checkout. */
  unsafePatterns: string[];
};

/**
 * Resolves a project's `preservePatterns` against one checkout with `fs.glob`: cost
 * scales with the matched set, never with the whole ignored tree. A match nested
 * inside another matched directory rides its parent. `.emdash.json` and `.git` are
 * never preserved entries; the registry owns both separately.
 */
export async function resolvePreservedEntries(
  checkoutPath: string,
  patterns: readonly string[]
): Promise<PreservedEntries> {
  const safePatterns: string[] = [];
  const unsafePatterns: string[] = [];
  for (const pattern of patterns) {
    (isSafePattern(pattern) ? safePatterns : unsafePatterns).push(pattern);
  }
  if (safePatterns.length === 0) return { entries: [], unsafePatterns };

  const matched = new Set<string>();
  for await (const match of glob(safePatterns, { cwd: checkoutPath })) {
    const relative = match.split(path.sep).join('/');
    if (relative === EMDASH_CONFIG_FILE || relative === '.git' || relative.startsWith('.git/')) {
      continue;
    }
    matched.add(relative);
  }

  const sorted = [...matched].sort();
  const entries: string[] = [];
  for (const entry of sorted) {
    const last = entries[entries.length - 1];
    if (last !== undefined && entry.startsWith(`${last}/`)) continue;
    entries.push(entry);
  }
  return { entries, unsafePatterns };
}

function isSafePattern(pattern: string): boolean {
  if (!pattern || path.isAbsolute(pattern)) return false;
  return !pattern.split(/[\\/]/).some((part) => part === '..');
}
