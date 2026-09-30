import { z } from 'zod';
import { permissionDecisionSchema } from '#runtimes/acp/api/models/permissions';
import { promptInputSchema, queuedPromptSchema } from '#runtimes/acp/api/models/prompt';
import { transcriptTurnSchema } from '#runtimes/acp/api/models/turns';
import { acpSetOptionErrorSchema } from './errors';
import { providerOptionValueSchema, providerOptionValuesSchema } from './models/config';
import { transcriptPositionSchema, transcriptCoverageSchema } from './models/transcript';

export const acpStartInputSchema = z.object({
  conversationId: z.string(),
  providerId: z.string(),
  cwd: z.string(),
  sessionId: z.string().nullable(),
  options: providerOptionValuesSchema.optional(),
  initialQueue: z.array(promptInputSchema).optional(),
  env: z.record(z.string(), z.string()).optional(),
});
export type AcpStartInputWire = z.infer<typeof acpStartInputSchema>;

export const acpSessionStartModeSchema = z.enum(['resume', 'fresh']);
export type AcpSessionStartMode = z.infer<typeof acpSessionStartModeSchema>;

export const sendPromptResponseSchema = z.object({ queued: z.boolean() });

export const terminateCommandSchema = z.object({ conversationId: z.string() });
export const promptPlacementSchema = z.enum(['auto', 'queue']);
export type PromptPlacement = z.infer<typeof promptPlacementSchema>;
export const sendPromptCommandSchema = z.object({
  conversationId: z.string(),
  /** Correlates session acceptance with the queue and transcript. */
  promptId: z.string().uuid(),
  prompt: promptInputSchema,
  /** 'queue' always queues; 'auto' (default) delivers if idle and queues while a turn is active. */
  placement: promptPlacementSchema.optional(),
});
export const editQueuedPromptCommandSchema = z.object({
  conversationId: z.string(),
  id: z.string(),
  input: promptInputSchema,
});
export const deleteQueuedPromptCommandSchema = z.object({
  conversationId: z.string(),
  id: z.string(),
});
export const changeQueuePromptOrderCommandSchema = z.object({
  conversationId: z.string(),
  ids: z.array(z.string()),
});
export const cancelTurnCommandSchema = z.object({ conversationId: z.string() });
export const setOptionCommandSchema = z.object({
  conversationId: z.string(),
  configId: z.string(),
  value: providerOptionValueSchema,
});
export const setOptionResultSchema = z.object({
  reapplyFailures: z.array(z.object({ configId: z.string(), error: acpSetOptionErrorSchema })),
});
export type AcpSetOptionResult = z.infer<typeof setOptionResultSchema>;
export const resolvePermissionCommandSchema = permissionDecisionSchema.extend({
  conversationId: z.string(),
});
export const exportAcpTranscriptCommandSchema = z.object({ conversationId: z.string() });
export const exportRawAcpLogCommandSchema = exportAcpTranscriptCommandSchema;

export const historyPageInputSchema = z.object({
  conversationId: z.string(),
  before: z.number().int().optional(),
  limit: z.number().int(),
});

export const historyPageSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('available'),
    turns: z.array(transcriptTurnSchema),
    nextCursor: z.number().int().nullable(),
    position: transcriptPositionSchema,
    coverage: transcriptCoverageSchema,
  }),
  /** History is activation-local and unavailable before activation or during replay. */
  z.object({ kind: z.literal('unavailable') }),
]);
export type HistoryPage = z.infer<typeof historyPageSchema>;

export { queuedPromptSchema };
