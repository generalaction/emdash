import { checkoutSelectorSchema } from '@runtimes/git/api/api/selectors';
import { z } from 'zod';
import { gitFilePathSchema, gitFileSourceSchema } from './schemas';

export const boundGitFileContentKeySchema = z.object({
  path: gitFilePathSchema,
  source: gitFileSourceSchema,
});
export type BoundGitFileContentKey = z.infer<typeof boundGitFileContentKeySchema>;

export const gitFileContentKeySchema = checkoutSelectorSchema.extend(
  boundGitFileContentKeySchema.shape
);
export type GitFileContentKey = z.infer<typeof gitFileContentKeySchema>;
