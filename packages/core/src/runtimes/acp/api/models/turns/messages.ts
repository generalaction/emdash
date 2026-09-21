import { z } from 'zod';
import { attachmentMetadataSchema } from '#services/attachments/api';

export const transcriptMessageSchema = z.object({
  kind: z.literal('message'),
  /** Opaque reducer-owned identity, scoped to the turn, role, and identity origin. */
  id: z.string(),
  /** Stable order within the owning turn, assigned once by the reducer. */
  seq: z.number().int(),
  role: z.enum(['user', 'assistant']),
  /** Correlates an accepted prompt without matching message text. */
  promptId: z.string().optional(),
  text: z.string(),
  /** Attachment metadata only; bytes are served separately by the runtime. */
  attachments: z.array(attachmentMetadataSchema).optional(),
});
export type TranscriptMessage = z.infer<typeof transcriptMessageSchema>;
