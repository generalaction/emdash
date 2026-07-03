import { z } from 'zod';

export const transcriptPlanSnapshotSchema = z.object({
  kind: z.literal('plan'),
  /** Marker item id scoped to the turn; actual plan content lives in the plan slice. */
  id: z.string(),
  /** Session-scoped plan id resolved against TranscriptPlanState. */
  planId: z.string(),
  /** Epoch ms of the plan update represented by this marker. */
  updatedAt: z.number(),
});
export type TranscriptPlanSnapshot = z.infer<typeof transcriptPlanSnapshotSchema>;
export type TranscriptPlan = TranscriptPlanSnapshot;
