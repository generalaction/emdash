import { z } from 'zod';

export const SESSION_PLAN_ID = 'session-plan';

export const planEntryStatusSchema = z.enum(['pending', 'in_progress', 'completed']);
export type PlanEntryStatus = z.infer<typeof planEntryStatusSchema>;

export const planEntryPrioritySchema = z.enum(['high', 'medium', 'low']);
export type PlanEntryPriority = z.infer<typeof planEntryPrioritySchema>;

export const transcriptPlanEntrySchema = z.object({
  /** Reducer-synthesized id; ACP plan updates do not provide stable entry ids. */
  id: z.string(),
  content: z.string(),
  status: planEntryStatusSchema,
  priority: planEntryPrioritySchema,
});
export type TranscriptPlanEntry = z.infer<typeof transcriptPlanEntrySchema>;

/** Raw provider plan entry before the reducer assigns a stable session-local id. */
export const transcriptPlanEntryInputSchema = transcriptPlanEntrySchema.omit({ id: true });
export type TranscriptPlanEntryInput = z.infer<typeof transcriptPlanEntryInputSchema>;

export const transcriptPlanStateSchema = z.object({
  /** Stable id of the session-scoped plan slice referenced by transcript markers. */
  id: z.string(),
  /** Latest full plan snapshot; providers replace the whole list on each update. */
  entries: z.array(transcriptPlanEntrySchema),
  /** Epoch ms when the reducer last received a plan update. */
  updatedAt: z.number(),
});
export type TranscriptPlanState = z.infer<typeof transcriptPlanStateSchema>;

