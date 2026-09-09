import { z } from 'zod';

export const transcriptThinkingSchema = z.object({
  kind: z.literal('thinking'),
  id: z.string(),
  /** Stable order within the owning turn, assigned once by the reducer. */
  seq: z.number().int(),
  /** Opaque reducer-owned stream segment identity; never interpreted as a provider id. */
  segmentId: z.string(),
  text: z.string(),
  status: z.enum(['thinking', 'done']),
  /** Epoch ms when the thinking row opened. */
  startedAt: z.number(),
  /** Frozen duration once the row is finalized. */
  durationMs: z.number().optional(),
});
export type TranscriptThinking = z.infer<typeof transcriptThinkingSchema>;
