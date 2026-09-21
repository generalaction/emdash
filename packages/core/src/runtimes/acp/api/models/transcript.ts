import { z } from 'zod';
import { transcriptTurnSchema } from './turns/turn';

/** Reconnects keep the generation; rebuilding the transcript starts a new one. */
export const transcriptPositionSchema = z.object({
  generation: z.string(),
  historyRevision: z.number().int().nonnegative(),
  lastCommittedTurnSeq: z.number().int().nullable(),
});
export type TranscriptPosition = z.infer<typeof transcriptPositionSchema>;

/** Published atomically so coalescing cannot hide a completed turn. */
export const transcriptSnapshotSchema = transcriptPositionSchema.extend({
  activeTurn: transcriptTurnSchema.nullable(),
});
export type TranscriptSnapshot = z.infer<typeof transcriptSnapshotSchema>;

/** Half-open authoritative range. Null denotes the beginning/end of history. */
export const transcriptCoverageSchema = z.object({
  fromSeq: z.number().int().nullable(),
  beforeSeq: z.number().int().nullable(),
});
