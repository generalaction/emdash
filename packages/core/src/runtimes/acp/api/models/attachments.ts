import { z } from 'zod';

export const imageAttachmentMimeTypeSchema = z.enum([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);
export type ImageAttachmentMimeType = z.infer<typeof imageAttachmentMimeTypeSchema>;

/** Runtime uploads may be images or arbitrary regular files. */
export const attachmentMimeTypeSchema = z.string().trim().min(1).max(255);
export type AttachmentMimeType = z.infer<typeof attachmentMimeTypeSchema>;

export const attachmentRefSchema = z.object({
  /** Runtime-owned immutable attachment id; clients use it as the cache key. */
  id: z.string(),
  name: z.string(),
  mimeType: attachmentMimeTypeSchema,
  /** Absolute path on the Host that owns the ACP runtime. Present for new uploads. */
  targetPath: z.string().optional(),
});
export type AttachmentRef = z.infer<typeof attachmentRefSchema>;

export const attachmentPromptAttachmentSchema = z.object({
  type: z.literal('attachment'),
  /** Runtime-owned attachment id returned by uploadAttachment. */
  id: z.string(),
  mimeType: imageAttachmentMimeTypeSchema,
  name: z.string().optional(),
});

export const promptAttachmentSchema = attachmentPromptAttachmentSchema;
export type PromptAttachment = z.infer<typeof promptAttachmentSchema>;
