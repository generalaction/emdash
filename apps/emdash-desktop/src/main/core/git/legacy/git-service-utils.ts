import type { GitChangeStatus } from '@emdash/shared/git';

/** Maximum bytes for fetching file content in diffs. */
export const MAX_DIFF_CONTENT_BYTES = 512 * 1024;

/**
 * Maximum bytes for ref-listing / fetch output. Repos with many thousands of refs
 * (e.g. monorepos) easily exceed Node's 1 MB default `maxBuffer`, which would otherwise
 * cause `git branch -a` and `git fetch` to fail silently with no branches surfaced.
 */
export const MAX_REF_LIST_BYTES = 64 * 1024 * 1024;

/**
 * Map a git status code (porcelain or diff-tree) to a typed GitChangeStatus.
 * Works for both two-char porcelain codes (e.g. ' M', 'A ', '??') and
 * single-letter diff-tree codes (e.g. 'A', 'D', 'R100').
 */
export function mapStatus(code: string): GitChangeStatus {
  if (code.includes('U') || code === 'AA' || code === 'DD') return 'conflicted';
  if (code.includes('A') || code.includes('?')) return 'added';
  if (code.includes('D')) return 'deleted';
  if (code.includes('R')) return 'renamed';
  return 'modified';
}

/** Strip exactly one trailing newline, if present. */
export function stripTrailingNewline(s: string): string {
  return s.endsWith('\n') ? s.slice(0, -1) : s;
}
