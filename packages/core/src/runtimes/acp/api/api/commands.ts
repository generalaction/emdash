import { attachmentRefSchema } from '@runtimes/acp/api/models/attachments';
import { permissionDecisionSchema } from '@runtimes/acp/api/models/permissions';
import {
  promptDraftUpdateSchema,
  promptInputSchema,
  queuedPromptSchema,
} from '@runtimes/acp/api/models/prompt';
import { z } from 'zod';

export const acpStartInputSchema = z.object({
  conversationId: z.string(),
  projectId: z.string(),
  taskId: z.string(),
  providerId: z.string(),
  workspaceId: z.string(),
  cwd: z.string(),
  sessionId: z.string().nullable(),
  model: z.string().nullable(),
  initialQueue: z.array(promptInputSchema).optional(),
});
export type AcpStartInputWire = z.infer<typeof acpStartInputSchema>;

export const sendPromptResponseSchema = z.object({ queued: z.boolean() });

export const startSessionCommandSchema = z.object({ input: acpStartInputSchema });
export const resumeSessionCommandSchema = z.object({
  input: acpStartInputSchema.extend({ sessionId: z.string() }),
});
export const stopSessionCommandSchema = z.object({ conversationId: z.string() });
export const sendPromptCommandSchema = z.object({
  conversationId: z.string(),
  prompt: promptInputSchema,
});
export const queuePromptCommandSchema = sendPromptCommandSchema;
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
export const setModelOptionCommandSchema = z.object({
  conversationId: z.string(),
  dimension: z.enum(['model', 'effort']),
  value: z.string(),
});
export const setModeOptionCommandSchema = z.object({
  conversationId: z.string(),
  value: z.string(),
});
export const resolvePermissionCommandSchema = permissionDecisionSchema.extend({
  conversationId: z.string(),
});
export const setPromptDraftCommandSchema = z.object({
  conversationId: z.string(),
  draft: promptDraftUpdateSchema,
});
export const exportAcpTranscriptCommandSchema = z.object({ conversationId: z.string() });
export const exportRawAcpLogCommandSchema = exportAcpTranscriptCommandSchema;

export const uploadAttachmentCommandSchema = z.object({
  originalPath: z.string().optional(),
});
export const uploadAttachmentResponseSchema = attachmentRefSchema;
export const downloadAttachmentCommandSchema = z.object({ id: z.string() });
export const deleteAttachmentCommandSchema = z.object({ id: z.string() });

export { queuedPromptSchema };
