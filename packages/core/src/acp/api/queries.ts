import { z } from 'zod';
import { transcriptTurnSchema } from '../models/turns';

export const getPromptDraftStateInputSchema = z.object({ conversationId: z.string() });

export const historyPageInputSchema = z.object({
  conversationId: z.string(),
  before: z.number().int().optional(),
  limit: z.number().int(),
});

export const historyPageSchema = z.object({
  turns: z.array(transcriptTurnSchema),
  nextCursor: z.number().int().nullable(),
});
export type HistoryPage = z.infer<typeof historyPageSchema>;

export const resumeResultSchema = historyPageSchema.extend({
  sessionId: z.string(),
});
export type ResumeResult = z.infer<typeof resumeResultSchema>;
