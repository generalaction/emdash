import { z } from 'zod';

export const imageAttachmentMimeTypeSchema = z.enum([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);
export type ImageAttachmentMimeType = z.infer<typeof imageAttachmentMimeTypeSchema>;

export const attachmentPromptAttachmentSchema = z.object({
  type: z.literal('attachment'),
  /** Conversation-owned attachment id returned by conversations.attachments.upload. */
  id: z.string(),
  mimeType: imageAttachmentMimeTypeSchema,
  name: z.string().optional(),
});

export const promptAttachmentSchema = attachmentPromptAttachmentSchema;
export type PromptAttachment = z.infer<typeof promptAttachmentSchema>;
