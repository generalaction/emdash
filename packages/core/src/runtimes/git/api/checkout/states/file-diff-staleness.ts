import { z } from 'zod';

export const fileDiffStalenessReasonSchema = z.enum([
  'content-changed',
  'index-changed',
  'ref-changed',
]);
export type FileDiffStalenessReason = z.infer<typeof fileDiffStalenessReasonSchema>;

export const fileDiffStalenessStateSchema = z.object({
  revision: z.number().int().nonnegative(),
  lastReason: fileDiffStalenessReasonSchema.optional(),
});
export type FileDiffStalenessState = z.infer<typeof fileDiffStalenessStateSchema>;
