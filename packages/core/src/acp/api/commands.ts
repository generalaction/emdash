import { z } from 'zod';
import { attachmentRefSchema, promptAttachmentSchema } from '../models/attachments';
import { permissionDecisionSchema } from '../models/permissions';
import { promptInputSchema, queuedPromptSchema } from '../models/prompt';

export const sessionConfigInputSchema = z.object({
  model: z.string().optional(),
  effort: z.string().optional(),
  mode: z.string().optional(),
});
export type SessionConfigInput = z.infer<typeof sessionConfigInputSchema>;

export const acpStartInputSchema = z.object({
  conversationId: z.string(),
  projectId: z.string(),
  taskId: z.string(),
  providerId: z.string(),
  workspaceId: z.string(),
  cwd: z.string(),
  sessionId: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  initialPrompt: z.string().optional(),
  sessionConfig: sessionConfigInputSchema.optional(),
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
export const editCurrentPromptCommandSchema = sendPromptCommandSchema;
export const exportAcpTranscriptCommandSchema = z.object({ conversationId: z.string() });

export const uploadAttachmentCommandSchema = z.object({
  attachment: promptAttachmentSchema,
});
export const uploadAttachmentResponseSchema = attachmentRefSchema;
export const downloadAttachmentCommandSchema = z.object({ id: z.string() });
export const downloadAttachmentResponseSchema = z.object({
  ref: attachmentRefSchema,
  data: z.instanceof(Uint8Array),
});
export const deleteAttachmentCommandSchema = z.object({ id: z.string() });

export { queuedPromptSchema };
