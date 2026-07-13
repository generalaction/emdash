import { attachmentRefSchema } from '@runtimes/acp/api/models/attachments';
import { z } from 'zod';

export const transcriptMessageSchema = z.object({
  kind: z.literal('message'),
  /** Provider message id scoped to the turn, or reducer-synthesized fallback id. */
  id: z.string(),
  /** Stable order within the owning turn, assigned once by the reducer. */
  seq: z.number().int(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  /** Attachment metadata only; bytes are served separately by the runtime. */
  attachments: z.array(attachmentRefSchema).optional(),
});
export type TranscriptMessage = z.infer<typeof transcriptMessageSchema>;
