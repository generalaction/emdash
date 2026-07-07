import { z } from 'zod';
import { fetchPrForReviewOptionsSchema, pushOptionsSchema } from './commands';
import { gitCheckoutInputSchema, gitRepositoryInputSchema } from './live';

export const transferProgressSchema = z.object({
  phase: z.string(),
  percent: z.number().int().min(0).max(100).optional(),
  objects: z
    .object({
      done: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    })
    .optional(),
  detail: z.string().optional(),
});
export type GitTransferProgress = z.infer<typeof transferProgressSchema>;

export const syncProgressSchema = transferProgressSchema.extend({
  step: z.enum(['pull', 'push']),
});
export type GitSyncProgress = z.infer<typeof syncProgressSchema>;

export const cloneRepositoryJobInputSchema = z.object({
  repositoryUrl: z.string(),
  targetPath: z.string(),
});
export type CloneRepositoryJobInput = z.infer<typeof cloneRepositoryJobInputSchema>;

export const fetchJobInputSchema = gitRepositoryInputSchema.extend({
  remote: z.string().optional(),
});
export type FetchJobInput = z.infer<typeof fetchJobInputSchema>;

export const publishBranchJobInputSchema = gitRepositoryInputSchema.extend({
  branchName: z.string(),
  remote: z.string().optional(),
});
export type PublishBranchJobInput = z.infer<typeof publishBranchJobInputSchema>;

export const fetchPrForReviewJobInputSchema = gitRepositoryInputSchema.extend({
  options: fetchPrForReviewOptionsSchema,
});
export type FetchPrForReviewJobInput = z.infer<typeof fetchPrForReviewJobInputSchema>;

export const pushJobInputSchema = gitCheckoutInputSchema.extend({
  options: pushOptionsSchema.optional(),
});
export type PushJobInput = z.infer<typeof pushJobInputSchema>;

export const pullJobInputSchema = gitCheckoutInputSchema;
export type PullJobInput = z.infer<typeof pullJobInputSchema>;

export const syncJobInputSchema = gitCheckoutInputSchema;
export type SyncJobInput = z.infer<typeof syncJobInputSchema>;
