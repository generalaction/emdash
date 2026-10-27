import { attachmentRefSchema, MAX_ATTACHMENT_FILES } from '@emdash/core/services/attachments/api';
import { z } from 'zod';

export const localTerminalFileSchema = z.object({
  path: z.string().min(1),
  name: z.string().optional(),
  mimeType: z.string().optional(),
  snapshot: z.boolean(),
});
export const localTerminalFilesSchema = z
  .array(localTerminalFileSchema)
  .min(1)
  .max(MAX_ATTACHMENT_FILES);
export type LocalTerminalFile = z.infer<typeof localTerminalFileSchema>;

export const preparedTerminalFileSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('reference'),
    targetPath: z.string(),
    pathStyle: z.enum(['posix', 'win32']),
  }),
  attachmentRefSchema.extend({ kind: z.literal('attachment') }),
]);
export type PreparedTerminalFile = z.infer<typeof preparedTerminalFileSchema>;
