import { z } from 'zod';
import { gitHeadModelSchema } from '../checkout/models/head';

export const ensureRepositoryOptionsSchema = z.object({
  initIfMissing: z.boolean().optional(),
});
export type EnsureRepositoryOptions = z.infer<typeof ensureRepositoryOptionsSchema>;

export const gitRepositoryInfoSchema = z.object({
  kind: z.literal('repository'),
  rootPath: z.string(),
  baseRef: z.string(),
});
export type GitRepositoryInfo = z.infer<typeof gitRepositoryInfoSchema>;

export const gitPathInspectionSchema = z.union([
  gitRepositoryInfoSchema,
  z.object({ kind: z.literal('not-repository'), path: z.string() }),
  z.object({ kind: z.literal('inspect-failed'), path: z.string(), message: z.string() }),
]);
export type GitPathInspection = z.infer<typeof gitPathInspectionSchema>;

export const cloneRepositoryJobInputSchema = z.object({
  repositoryUrl: z.string(),
  targetPath: z.string(),
});
export type CloneRepositoryJobInput = z.infer<typeof cloneRepositoryJobInputSchema>;

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

export const checkoutInfoSchema = z.object({
  checkoutPath: z.string(),
  isMain: z.boolean(),
  head: gitHeadModelSchema,
  locked: z.boolean().optional(),
  prunable: z.boolean().optional(),
});
export type CheckoutInfo = z.infer<typeof checkoutInfoSchema>;
