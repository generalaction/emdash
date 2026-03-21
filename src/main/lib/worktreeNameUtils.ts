import crypto from 'crypto';

/**
 * Shared utilities for worktree and branch name sanitization.
 * Used by both WorktreeService and WorktreePoolService.
 */

/** Generate a short random hash for fallback names */
function generateShortHash(): string {
  const bytes = crypto.randomBytes(3);
  return bytes.readUIntBE(0, 3).toString(36).slice(0, 3).padStart(3, '0');
}

/** Slugify a string for use in branch/worktree names */
function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Sanitize branch name to ensure it's a valid Git ref.
 * Returns a fallback name if sanitization results in an empty/invalid string.
 */
export function sanitizeBranchName(name: string, prefix = 'emdash'): string {
  let n = name
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._\/-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/\/+/g, '/');
  n = n.replace(/^[./-]+/, '').replace(/[./-]+$/, '');
  if (!n || n === 'HEAD') {
    n = `${prefix}/${slugify('task')}-${generateShortHash()}`;
  }
  return n;
}

/**
 * Sanitize worktree directory name to ensure it's a valid path component.
 * Returns a fallback name if sanitization results in an empty string.
 */
export function sanitizeWorktreeName(name: string): string {
  const sanitized = name
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
  // Fallback if sanitization results in empty string
  return sanitized || `worktree-${generateShortHash()}`;
}
