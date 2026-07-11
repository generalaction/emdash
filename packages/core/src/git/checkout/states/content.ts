import { z } from 'zod';
import { gitCommandErrorSchema } from '../../api/errors';
import { gitFilePathSchema, gitFileSourceSchema } from '../schemas';

const gitFileContentBaseSchema = z.object({
  path: gitFilePathSchema,
  source: gitFileSourceSchema,
});

const availableGitFileContentSchema = gitFileContentBaseSchema.extend({
  oid: z.string(),
  byteSize: z.number().int().nonnegative(),
});

export const gitFileContentStateSchema = z.discriminatedUnion('kind', [
  availableGitFileContentSchema.extend({
    kind: z.literal('text'),
    content: z.string(),
  }),
  availableGitFileContentSchema.extend({
    kind: z.literal('binary'),
  }),
  gitFileContentBaseSchema.extend({
    kind: z.literal('missing'),
  }),
  gitFileContentBaseSchema.extend({
    kind: z.literal('unavailable'),
    error: gitCommandErrorSchema,
  }),
]);

export type GitFileContentState = z.infer<typeof gitFileContentStateSchema>;
