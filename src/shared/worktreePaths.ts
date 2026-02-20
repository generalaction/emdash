export const INSIDE_PROJECT_WORKTREE_BASE_PATH = '.worktrees';

/**
 * Cross-platform renderer/backend alias for "system temp worktrees".
 *
 * We persist this stable token in project settings and resolve it to a
 * platform-specific absolute path in main process code.
 */
export const TEMP_WORKTREE_BASE_PATH_ALIAS = '__emdash_temp__';
