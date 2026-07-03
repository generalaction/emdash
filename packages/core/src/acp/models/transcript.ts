import { z } from 'zod';
import { transcriptTurnSchema } from './turns';

export const transcriptStateSchema = z.object({
  /** Finalized turns in chronological order. */
  committed: z.array(transcriptTurnSchema),
  /** Current in-flight turn, or null when the transcript is idle. */
  active: transcriptTurnSchema.nullable(),
});
export type TranscriptState = z.infer<typeof transcriptStateSchema>;

export * from './turns';
