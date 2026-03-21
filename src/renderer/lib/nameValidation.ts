/**
 * Validation helpers for custom branch and worktree names.
 * Empty values return null (valid - will auto-generate).
 */

/**
 * Validate a custom branch name.
 * Returns error message if invalid, null if valid.
 *
 * Rules (from git check-ref-format):
 * - No whitespace
 * - No ".." (parent directory reference)
 * - No leading "-" (git flag confusion)
 * - No ".lock" suffix (git lock file)
 * - No "@{" (reflog syntax)
 * - No special characters: ~ ^ : ? * [ ] \
 * - No control characters
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

  // Check for whitespace and special characters forbidden by git
  // eslint-disable-next-line no-control-regex
  if (/[\s~^:?*[\]\\\x00-\x1f\x7f]/.test(trimmed)) {
    return 'Branch name contains invalid characters (spaces, ~, ^, :, ?, *, [, ], \\)';
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
