import { z } from 'zod';
import { repositoryKeySchema } from './key';

/**
 * Repository subdomain schemas: option shapes for branch / tag / worktree
 * mutations and the input shapes for repository-scoped jobs (fetch / publish /
 * fetch-PR). The worktree descriptor (`checkoutInfoSchema`) is cross-cutting and
 * lives in `../api/schemas`.
 */

export const createBranchOptionsSchema = z.object({
  name: z.string(),
  from: z.string().optional(),
  syncWithRemote: z.boolean().optional(),
  remote: z.string().optional(),
});
export type CreateBranchOptions = z.infer<typeof createBranchOptionsSchema>;

export const fetchPrForReviewOptionsSchema = z.object({
  prNumber: z.number().int(),
  headRefName: z.string(),
  headRepositoryUrl: z.string(),
  localBranch: z.string(),
  isFork: z.boolean(),
  configuredRemote: z.string().optional(),
});
export type FetchPrForReviewOptions = z.infer<typeof fetchPrForReviewOptionsSchema>;

export const addCheckoutOptionsSchema = z.object({
  /** Destination path for the new worktree. */
  path: z.string(),
  /** Branch to check out; creates it if combined with `newBranch`. */
  ref: z.string().optional(),
  /** Name for a new branch created at this worktree. */
  newBranch: z.string().optional(),
  force: z.boolean().optional(),
});
export type AddCheckoutOptions = z.infer<typeof addCheckoutOptionsSchema>;

export const tagOptionsSchema = z.object({
  name: z.string(),
  ref: z.string().optional(),
  message: z.string().optional(),
  force: z.boolean().optional(),
});
export type TagOptions = z.infer<typeof tagOptionsSchema>;

// -- Job inputs --

export const fetchJobInputSchema = repositoryKeySchema.extend({
  remote: z.string().optional(),
});
export type FetchJobInput = z.infer<typeof fetchJobInputSchema>;

export const publishBranchJobInputSchema = repositoryKeySchema.extend({
  branchName: z.string(),
  remote: z.string().optional(),
});
export type PublishBranchJobInput = z.infer<typeof publishBranchJobInputSchema>;

export const fetchPrForReviewJobInputSchema = repositoryKeySchema.extend({
  options: fetchPrForReviewOptionsSchema,
});
export type FetchPrForReviewJobInput = z.infer<typeof fetchPrForReviewJobInputSchema>;
