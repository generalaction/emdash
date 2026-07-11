import { z } from 'zod';
import { hostAbsolutePathSchema } from '../../path';

export const ensureRepositoryOptionsSchema = z.object({
  initIfMissing: z.boolean().optional(),
});
export type EnsureRepositoryOptions = z.infer<typeof ensureRepositoryOptionsSchema>;

export const gitRepositoryInfoSchema = z.object({
  kind: z.literal('repository'),
  rootPath: hostAbsolutePathSchema,
  baseRef: z.string(),
});
export type GitRepositoryInfo = z.infer<typeof gitRepositoryInfoSchema>;

export const gitPathInspectionSchema = z.union([
  gitRepositoryInfoSchema,
  z.object({ kind: z.literal('not-repository'), path: hostAbsolutePathSchema }),
  z.object({
    kind: z.literal('inspect-failed'),
    path: hostAbsolutePathSchema,
    message: z.string(),
  }),
]);
export type GitPathInspection = z.infer<typeof gitPathInspectionSchema>;

export const cloneRepositoryJobInputSchema = z.object({
  repositoryUrl: z.string(),
  targetPath: hostAbsolutePathSchema,
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
