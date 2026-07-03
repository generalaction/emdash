import { z } from 'zod';

export const promptAttachmentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('image'),
    /** Base64-encoded bytes for one-shot prompt submission. Not stored in LiveModels. */
    data: z.string(),
    mimeType: z.string(),
    name: z.string().optional(),
  }),
]);
export type PromptAttachment = z.infer<typeof promptAttachmentSchema>;

export const promptInputSchema = z.object({
  text: z.string(),
  attachments: z.array(promptAttachmentSchema).optional(),
});
export type PromptInput = z.infer<typeof promptInputSchema>;

export const queuedPromptSchema = promptInputSchema.extend({
  /** Runtime-generated id used for queue removal and stable UI keys. */
  id: z.string(),
});
export type QueuedPrompt = z.infer<typeof queuedPromptSchema>;