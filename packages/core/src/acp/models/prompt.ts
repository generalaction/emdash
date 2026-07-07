import { z } from 'zod';
import { promptAttachmentSchema } from './attachments';
export type { PromptAttachment } from './attachments';

export const promptInputSchema = z.object({
  text: z.string(),
  hiddenContext: z.string().optional(),
  attachments: z.array(promptAttachmentSchema).optional(),
});
export type PromptInput = z.infer<typeof promptInputSchema>;

export const promptDraftInputSchema = promptInputSchema.extend({
  /** Monotonic writer revision used by clients to suppress stale draft echoes. */
  rev: z.number(),
});
export type PromptDraftInput = z.infer<typeof promptDraftInputSchema>;

export const promptDraftSchema = promptDraftInputSchema.extend({
  /** Epoch ms when the runtime last accepted this draft revision. */
  updatedAt: z.number(),
});
export type PromptDraft = z.infer<typeof promptDraftSchema>;

export const promptDraftUpdateSchema = z.object({
  /** Monotonic writer revision used to ignore stale draft updates, including clears. */
  rev: z.number(),
  input: promptInputSchema.nullable(),
});
export type PromptDraftUpdate = z.infer<typeof promptDraftUpdateSchema>;

export const queuedPromptSchema = promptInputSchema.extend({
  /** Runtime-generated id used for queue removal and stable UI keys. */
  id: z.string(),
  /** Epoch ms when this prompt entered the runtime queue/model. */
  createdAt: z.number(),
  /** Epoch ms when queued prompt content or attachments were last edited. */
  updatedAt: z.number(),
});
export type QueuedPrompt = z.infer<typeof queuedPromptSchema>;
