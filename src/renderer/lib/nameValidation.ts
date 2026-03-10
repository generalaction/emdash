/**
 * Validation helpers for custom branch and worktree names.
 * Empty values return null (valid - will auto-generate).
 */

/**
 * Validate a custom branch name.
 * Returns error message if invalid, null if valid.
 *
 * Rules:
 * - No whitespace
 * - No ".." (parent directory reference)
 * - No leading "-" (git flag confusion)
 * - No ".lock" suffix (git lock file)
 * - No "@{" (reflog syntax)
 * - Max 250 characters
 */
export function validateBranchName(name: string): string | null {
  // Empty is valid (will auto-generate)
  if (!name || !name.trim()) {
    return null;
  }

  const trimmed = name.trim();

  if (trimmed.length > 250) {
    return 'Branch name must be 250 characters or less';
  }

  if (/\s/.test(trimmed)) {
    return 'Branch name cannot contain whitespace';
  }

  if (trimmed.includes('..')) {
    return 'Branch name cannot contain ".."';
  }

  if (trimmed.startsWith('-')) {
    return 'Branch name cannot start with "-"';
  }

  if (trimmed.endsWith('.lock')) {
    return 'Branch name cannot end with ".lock"';
  }

  if (trimmed.includes('@{')) {
    return 'Branch name cannot contain "@{"';
  }

  // Git also disallows some other characters, but we'll let the backend handle those
  // via sanitization. These are the most common user errors.

  return null;
}

/**
 * Validate a custom worktree directory name.
 * Returns error message if invalid, null if valid.
 *
 * Rules:
 * - No path separators (/ \ : * ? " < > |)
 * - Not "." or ".."
 * - Max 100 characters
 */
export function validateWorktreeName(name: string): string | null {
  // Empty is valid (will auto-generate)
  if (!name || !name.trim()) {
    return null;
  }

  const trimmed = name.trim();

  if (trimmed.length > 100) {
    return 'Worktree name must be 100 characters or less';
  }

  if (trimmed === '.' || trimmed === '..') {
    return 'Worktree name cannot be "." or ".."';
  }

  // Characters that are invalid in file/directory names across platforms
  if (/[/\\:*?"<>|]/.test(trimmed)) {
    return 'Worktree name cannot contain / \\ : * ? " < > |';
  }

  return null;
}
