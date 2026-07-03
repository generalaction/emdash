import { z } from 'zod';

export const attachmentRefSchema = z.object({
  /** Runtime-owned immutable attachment id; clients use it as the cache key. */
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
});
export type AttachmentRef = z.infer<typeof attachmentRefSchema>;
