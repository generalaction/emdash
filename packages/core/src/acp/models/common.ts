import { z } from 'zod';

export const toolStatusSchema = z.enum(['running', 'done', 'error']);
export type ToolStatus = z.infer<typeof toolStatusSchema>;

export const stopReasonSchema = z.enum([
  'end_turn',
  'max_tokens',
  'max_turn_requests',
  'refusal',
  'cancelled',
]);
export type StopReason = z.infer<typeof stopReasonSchema>;

export const attachmentRefSchema = z.object({
  /** Runtime-owned immutable attachment id; clients use it as the cache key. */
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
});
export type AttachmentRef = z.infer<typeof attachmentRefSchema>;
