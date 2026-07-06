import { z } from 'zod';
import { promptAttachmentSchema } from './attachments';
export type { PromptAttachment } from './attachments';

export const promptInputSchema = z.object({
  text: z.string(),
  attachments: z.array(promptAttachmentSchema).optional(),
});
export type PromptInput = z.infer<typeof promptInputSchema>;

export const queuedPromptSchema = promptInputSchema.extend({
  /** Runtime-generated id used for queue removal and stable UI keys. */
  id: z.string(),
  /** Epoch ms when this prompt entered the runtime queue/model. */
  createdAt: z.number(),
  /** Epoch ms when queued prompt content or attachments were last edited. */
  updatedAt: z.number(),
});
export type QueuedPrompt = z.infer<typeof queuedPromptSchema>;
