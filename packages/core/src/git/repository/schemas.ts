import { z } from 'zod';
import { hostAbsolutePathSchema } from '../../path';
import { repositorySelectorSchema } from '../api/selectors';

/**
 * Repository subdomain schemas: option shapes for branch / tag / worktree
 * mutations and the input shapes for repository-scoped jobs (fetch / publish /
 * fetch-PR). The worktree descriptor (`checkoutInfoSchema`) is cross-cutting and
 * lives in `../api/schemas`.
 */

export const explicitCreateBranchOptionsSchema = z.object({
  name: z.string(),
  /** Explicit start ref. Repository execution never inherits a checkout's HEAD. */
  from: z.string(),
  syncWithRemote: z.boolean().optional(),
  remote: z.string().optional(),
});
export type ExplicitCreateBranchOptions = z.infer<typeof explicitCreateBranchOptionsSchema>;

export const fetchPrForReviewOptionsSchema = z.object({
  prNumber: z.number().int(),
  headRefName: z.string(),
  headRepositoryUrl: z.string(),
  localBranch: z.string(),
  isFork: z.boolean(),
  configuredRemote: z.string().optional(),
});
export type FetchPrForReviewOptions = z.infer<typeof fetchPrForReviewOptionsSchema>;

export const addWorktreeOptionsSchema = z.object({
  /** Destination path for the new worktree. */
  path: hostAbsolutePathSchema,
  /** Explicit ref to check out; creates `newBranch` from this ref when supplied. */
  ref: z.string(),
  /** Name for a new branch created at this worktree. */
  newBranch: z.string().optional(),
  force: z.boolean().optional(),
});
export type AddWorktreeOptions = z.infer<typeof addWorktreeOptionsSchema>;

export const explicitTagOptionsSchema = z.object({
  name: z.string(),
  /** Explicit target ref. Repository execution never inherits a checkout's HEAD. */
  ref: z.string(),
  message: z.string().optional(),
  force: z.boolean().optional(),
});
export type ExplicitTagOptions = z.infer<typeof explicitTagOptionsSchema>;

// -- Job inputs --

export const fetchJobInputSchema = repositorySelectorSchema.extend({
  remote: z.string().optional(),
});
export type FetchJobInput = z.infer<typeof fetchJobInputSchema>;

export const publishBranchJobInputSchema = repositorySelectorSchema.extend({
  branchName: z.string(),
  remote: z.string().optional(),
});
export type PublishBranchJobInput = z.infer<typeof publishBranchJobInputSchema>;

export const fetchPrForReviewJobInputSchema = repositorySelectorSchema.extend({
  options: fetchPrForReviewOptionsSchema,
});
export type FetchPrForReviewJobInput = z.infer<typeof fetchPrForReviewJobInputSchema>;
