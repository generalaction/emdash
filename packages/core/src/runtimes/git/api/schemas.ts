import { z } from 'zod';
import { hostAbsolutePathSchema } from '#primitives/path/api';

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

// Success data of the fallible `inspectPath`: repository/not-repository are
// answers; a failed inspection is the verb's declared error.
export const gitPathInspectionSchema = z.discriminatedUnion('kind', [
  gitRepositoryInfoSchema,
  z.object({ kind: z.literal('not-repository'), path: hostAbsolutePathSchema }),
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
