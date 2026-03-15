/**
 * Defines the cleanup mode for remote branches when a task is archived or deleted.
 *
 * - `'ask'`   — Prompt the user each time: "Also delete remote branch?"
 * - `'always'` — Automatically delete the remote branch.
 * - `'never'`  — Never delete the remote branch (default / current behavior).
 * - `'auto'`   — Auto-delete remote branches older than a configurable threshold.
 */
export type RemoteBranchCleanupMode = 'ask' | 'always' | 'never' | 'auto';

/** All valid cleanup mode values, used for runtime validation. */
export const REMOTE_BRANCH_CLEANUP_MODES: readonly RemoteBranchCleanupMode[] = [
  'ask',
  'always',
  'never',
  'auto',
] as const;

/** Default cleanup mode when none is configured. */
export const DEFAULT_REMOTE_BRANCH_CLEANUP_MODE: RemoteBranchCleanupMode = 'never';

/** Default threshold in days for the 'auto' mode. */
export const DEFAULT_REMOTE_BRANCH_CLEANUP_DAYS = 7;

/** Minimum allowed threshold in days for the 'auto' mode. */
export const MIN_REMOTE_BRANCH_CLEANUP_DAYS = 1;

/** Maximum allowed threshold in days for the 'auto' mode. */
export const MAX_REMOTE_BRANCH_CLEANUP_DAYS = 365;

/**
 * Type guard: returns true if the value is a valid RemoteBranchCleanupMode.
 */
export function isValidRemoteBranchCleanupMode(value: unknown): value is RemoteBranchCleanupMode {
  return (
    typeof value === 'string' &&
    REMOTE_BRANCH_CLEANUP_MODES.includes(value as RemoteBranchCleanupMode)
  );
}

/**
 * Clamp a days-threshold value to the allowed range, returning the default
 * if the input is not a finite number.
 */
export function clampCleanupDays(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_REMOTE_BRANCH_CLEANUP_DAYS;
  }
  const rounded = Math.round(value);
  if (rounded < MIN_REMOTE_BRANCH_CLEANUP_DAYS) return MIN_REMOTE_BRANCH_CLEANUP_DAYS;
  if (rounded > MAX_REMOTE_BRANCH_CLEANUP_DAYS) return MAX_REMOTE_BRANCH_CLEANUP_DAYS;
  return rounded;
}
