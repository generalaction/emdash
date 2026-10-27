import { defineContract, downloadFile, fallible, uploadFile } from '@emdash/wire/rpc';
import { z } from 'zod';

export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export const MAX_ATTACHMENT_FILES = 20;

export const attachmentOwnerIdSchema = z
  .string()
  .min(1)
  .refine((id) => id !== '.' && id !== '..' && !/[/\\\0]/.test(id));
export const attachmentOwnerSchema = z.object({
  kind: z.enum(['conversation', 'workspace']),
  id: attachmentOwnerIdSchema,
});
export type AttachmentOwner = z.infer<typeof attachmentOwnerSchema>;

export const attachmentMimeTypeSchema = z.string().trim().min(1).max(255);
export type AttachmentMimeType = z.infer<typeof attachmentMimeTypeSchema>;

export const attachmentMetadataSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: attachmentMimeTypeSchema,
});

export const attachmentRefSchema = attachmentMetadataSchema.extend({
  /** Absolute native path on the owner's Host. */
  targetPath: z.string().min(1),
  pathStyle: z.enum(['posix', 'win32']),
});
export type AttachmentRef = z.infer<typeof attachmentRefSchema>;

const conversationKey = z.object({
  conversationId: attachmentOwnerIdSchema,
});
const attachmentKey = conversationKey.extend({ attachmentId: z.string().min(1) });

export const attachmentErrorSchema = z.object({
  type: z.enum(['owner-not-found', 'attachment-not-found', 'storage-failed']),
  message: z.string(),
});
export type AttachmentError = z.infer<typeof attachmentErrorSchema>;

const workspaceKey = z.object({ workspaceId: attachmentOwnerIdSchema });
export const workspaceAttachmentsContract = defineContract({
  attachments: defineContract({
    upload: uploadFile({
      input: workspaceKey,
      maxSize: MAX_ATTACHMENT_BYTES,
      result: attachmentRefSchema,
      error: attachmentErrorSchema,
    }),
    download: downloadFile({
      input: workspaceKey.extend({ attachmentId: z.string().min(1) }),
      meta: attachmentRefSchema,
      error: attachmentErrorSchema,
    }),
    delete: fallible({
      input: workspaceKey.extend({ attachmentId: z.string().min(1) }),
      error: attachmentErrorSchema,
    }),
  }),
});

/** Conversation-owned bytes, independent of the protocol used to run the agent. */
export const conversationAttachmentsContract = defineContract({
  attachments: defineContract({
    upload: uploadFile({
      input: conversationKey,
      maxSize: MAX_ATTACHMENT_BYTES,
      result: attachmentRefSchema,
      error: attachmentErrorSchema,
    }),
    download: downloadFile({
      input: attachmentKey,
      meta: attachmentRefSchema,
      error: attachmentErrorSchema,
    }),
    delete: fallible({ input: attachmentKey, error: attachmentErrorSchema }),
  }),
});
