import { z } from 'zod';

export const fileDiffStalenessReasonSchema = z.enum([
  'content-changed',
  'index-changed',
  'ref-changed',
]);
export type FileDiffStalenessReason = z.infer<typeof fileDiffStalenessReasonSchema>;

export const fileDiffStalenessSchema = z.object({
  revision: z.number().int().nonnegative(),
  lastReason: fileDiffStalenessReasonSchema.optional(),
});
export type FileDiffStaleness = z.infer<typeof fileDiffStalenessSchema>;
