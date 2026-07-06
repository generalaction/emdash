import { z } from 'zod';

export const attachmentMimeTypeSchema = z.enum([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);
export type AttachmentMimeType = z.infer<typeof attachmentMimeTypeSchema>;

export const attachmentRefSchema = z.object({
  /** Runtime-owned immutable attachment id; clients use it as the cache key. */
  id: z.string(),
  name: z.string(),
  mimeType: attachmentMimeTypeSchema,
});
export type AttachmentRef = z.infer<typeof attachmentRefSchema>;

export const promptAttachmentSchema = z.object({
  type: z.literal('local-file'),
  /** Same-machine source path; AttachmentManager can reference instead of copying bytes. */
  originalPath: z.string(),
  mimeType: attachmentMimeTypeSchema,
  name: z.string().optional(),
});
export type PromptAttachment = z.infer<typeof promptAttachmentSchema>;
