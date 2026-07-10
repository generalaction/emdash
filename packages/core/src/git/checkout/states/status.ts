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
export type GitStatusCode = z.infer<typeof gitStatusCodeSchema>;

export const fileGitStatusSchema = z.object({
  path: z.string(),
  index: gitStatusCodeSchema,
  worktree: gitStatusCodeSchema,
  origPath: z.string().optional(),
  isConflicted: z.boolean(),
});
export type FileGitStatus = z.infer<typeof fileGitStatusSchema>;

export const checkoutOperationSchema = z.enum([
  'none',
  'merge',
  'rebase',
  'cherry-pick',
  'revert',
  'bisect',
]);
export type CheckoutOperation = z.infer<typeof checkoutOperationSchema>;

export const checkoutStatusSummarySchema = z.object({
  staged: z.number().int().nonnegative(),
  unstaged: z.number().int().nonnegative(),
  conflicted: z.number().int().nonnegative(),
  untracked: z.number().int().nonnegative(),
});
export type CheckoutStatusSummary = z.infer<typeof checkoutStatusSummarySchema>;

/** Flat absolute-path status snapshot for one checkout. */
export const checkoutStatusStateSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ok'),
    entries: z.record(z.string(), fileGitStatusSchema),
    summary: checkoutStatusSummarySchema,
    operation: checkoutOperationSchema,
  }),
  z.object({ kind: z.literal('too-many-files') }),
  z.object({ kind: z.literal('error'), message: z.string() }),
]);

export type CheckoutStatusState = z.infer<typeof checkoutStatusStateSchema>;
