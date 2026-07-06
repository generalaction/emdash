import { z } from 'zod';

export const gitStatusCodeSchema = z.enum([
  'unmodified',
  'modified',
  'added',
  'deleted',
  'renamed',
  'copied',
  'type-changed',
  'untracked',
  'ignored',
  'unmerged',
]);

/**
 * Per-side status code from git porcelain v2 (XY format).
 * Each file entry carries an `index` code and a `worktree` code independently.
 */
export const fileGitStatusSchema = z.object({
  path: z.string(),
  index: gitStatusCodeSchema,
  worktree: gitStatusCodeSchema,
  /** Original path, set for renames and copies. */
  origPath: z.string().optional(),
  isConflicted: z.boolean(),
});

export const checkoutOperationSchema = z.enum([
  'none',
  'merge',
  'rebase',
  'cherry-pick',
  'revert',
  'bisect',
]);

export const checkoutStatusSummarySchema = z.object({
  staged: z.number().int().nonnegative(),
  unstaged: z.number().int().nonnegative(),
  conflicted: z.number().int().nonnegative(),
  untracked: z.number().int().nonnegative(),
});

/**
 * Normalized checkout status model.
 * `entries` is a flat map keyed by path — each file appears once regardless of
 * whether it is staged, unstaged, both, or conflicted.
 */
export const checkoutStatusModelSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ok'),
    entries: z.record(z.string(), fileGitStatusSchema),
    summary: checkoutStatusSummarySchema,
    operation: checkoutOperationSchema,
  }),
  z.object({ kind: z.literal('too-many-files') }),
  z.object({ kind: z.literal('error'), message: z.string() }),
]);
