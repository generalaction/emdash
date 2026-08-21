import { z } from 'zod';
import { attachmentRefSchema } from '#runtimes/acp/api/models/attachments';
import { permissionDecisionSchema } from '#runtimes/acp/api/models/permissions';
import { promptInputSchema, queuedPromptSchema } from '#runtimes/acp/api/models/prompt';
import { transcriptTurnSchema } from '#runtimes/acp/api/models/turns';

export const acpStartInputSchema = z.object({
  conversationId: z.string(),
  providerId: z.string(),
  cwd: z.string(),
  sessionId: z.string().nullable(),
  model: z.string().nullable(),
  modeId: z.string().nullable().optional(),
  initialQueue: z.array(promptInputSchema).optional(),
  env: z.record(z.string(), z.string()).optional(),
});
export type AcpStartInputWire = z.infer<typeof acpStartInputSchema>;

export const acpResumeInputSchema = acpStartInputSchema.extend({ sessionId: z.string() });

export const sendPromptResponseSchema = z.object({ queued: z.boolean() });

export const killCommandSchema = z.object({ conversationId: z.string() });
export const promptPlacementSchema = z.enum(['auto', 'queue']);
export type PromptPlacement = z.infer<typeof promptPlacementSchema>;
const activationFenceSchema = z.object({ activationId: z.string().optional() });
const activationDescriptorSchema = z.object({ activation: acpStartInputSchema });

export const sendPromptInputSchema = z
  .object({
    conversationId: z.string(),
    prompt: promptInputSchema,
    /** 'queue' always queues; 'auto' (default) delivers if idle and queues while a turn is active. */
    placement: promptPlacementSchema.optional(),
  })
  .extend(activationFenceSchema.shape);
export const sendPromptCommandSchema = sendPromptInputSchema.extend(
  activationDescriptorSchema.shape
);
export const editQueuedPromptInputSchema = z
  .object({
    conversationId: z.string(),
    id: z.string(),
    input: promptInputSchema,
  })
  .extend(activationFenceSchema.shape);
export const editQueuedPromptCommandSchema = editQueuedPromptInputSchema.extend(
  activationDescriptorSchema.shape
);
export const deleteQueuedPromptInputSchema = z
  .object({
    conversationId: z.string(),
    id: z.string(),
  })
  .extend(activationFenceSchema.shape);
export const deleteQueuedPromptCommandSchema = deleteQueuedPromptInputSchema.extend(
  activationDescriptorSchema.shape
);
export const changeQueuePromptOrderInputSchema = z
  .object({
    conversationId: z.string(),
    ids: z.array(z.string()),
  })
  .extend(activationFenceSchema.shape);
export const changeQueuePromptOrderCommandSchema = changeQueuePromptOrderInputSchema.extend(
  activationDescriptorSchema.shape
);
export const cancelTurnCommandSchema = z.object({ conversationId: z.string() });
export const setModelOptionInputSchema = z
  .object({
    conversationId: z.string(),
    dimension: z.enum(['model', 'effort']),
    value: z.string(),
  })
  .extend(activationFenceSchema.shape);
export const setModelOptionCommandSchema = setModelOptionInputSchema.extend(
  activationDescriptorSchema.shape
);
export const setModeOptionInputSchema = z
  .object({
    conversationId: z.string(),
    value: z.string(),
  })
  .extend(activationFenceSchema.shape);
export const setModeOptionCommandSchema = setModeOptionInputSchema.extend(
  activationDescriptorSchema.shape
);
export const resolvePermissionInputSchema = permissionDecisionSchema
  .extend({
    conversationId: z.string(),
  })
  .extend(activationFenceSchema.shape);
export const resolvePermissionCommandSchema = resolvePermissionInputSchema.extend(
  activationDescriptorSchema.shape
);
export const exportAcpTranscriptInputSchema = z
  .object({ conversationId: z.string() })
  .extend(activationFenceSchema.shape);
export const exportAcpTranscriptCommandSchema = exportAcpTranscriptInputSchema.extend(
  activationDescriptorSchema.shape
);
export const exportRawAcpLogCommandSchema = exportAcpTranscriptCommandSchema;

export const uploadAttachmentCommandSchema = z.object({
  /** Attachments belong to their conversation (spec §3.6); a conversation exists at upload time. */
  conversationId: z.string(),
  originalPath: z.string().optional(),
});
export const uploadAttachmentResponseSchema = attachmentRefSchema;
export const attachmentKeySchema = z.object({
  conversationId: z.string(),
  attachmentId: z.string(),
});
export const downloadAttachmentCommandSchema = attachmentKeySchema;
export const deleteAttachmentCommandSchema = attachmentKeySchema;
export const deleteAttachmentsCommandSchema = z.object({
  conversationId: z.string(),
});

export const historyPageDesktopInputSchema = z
  .object({
    conversationId: z.string(),
    before: z.number().int().optional(),
    limit: z.number().int(),
  })
  .extend(activationFenceSchema.shape);
export const historyPageInputSchema = historyPageDesktopInputSchema.extend(
  activationDescriptorSchema.shape
);

export const historyPageSchema = z.object({
  turns: z.array(transcriptTurnSchema),
  nextCursor: z.number().int().nullable(),
});
export type HistoryPage = z.infer<typeof historyPageSchema>;

export const resumeResultSchema = historyPageSchema.extend({
  sessionId: z.string(),
  activationId: z.string(),
});
export type ResumeResult = z.infer<typeof resumeResultSchema>;

export { queuedPromptSchema };
