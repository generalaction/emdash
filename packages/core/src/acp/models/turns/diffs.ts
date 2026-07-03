import { z } from 'zod';
import { toolStatusSchema } from '../tools';

export const transcriptDiffSchema = z.object({
  kind: z.literal('diff'),
  id: z.string(),
  path: z.string(),
  /** Null when the file did not exist before the edit. */
  oldText: z.string().nullable(),
  newText: z.string(),
  status: toolStatusSchema,
  parentId: z.string().optional(),
});
export type TranscriptDiff = z.infer<typeof transcriptDiffSchema>;
