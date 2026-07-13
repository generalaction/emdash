import { portableRelativePathSchema } from '@primitives/path/api';
import { fsErrorSchema } from '@runtimes/files/api/api/errors';
import { z } from 'zod';

const fileContentBaseSchema = z.object({
  path: portableRelativePathSchema,
  etag: z.string(),
  byteSize: z.number().int().nonnegative(),
  readonly: z.boolean(),
});

export const fileContentModelSchema = z.discriminatedUnion('kind', [
  fileContentBaseSchema.extend({
    kind: z.literal('text'),
    content: z.string(),
    eol: z.enum(['lf', 'crlf']),
    truncated: z.boolean(),
  }),
  fileContentBaseSchema.extend({
    kind: z.literal('binary'),
    mimeType: z.string().optional(),
  }),
  z.object({
    kind: z.literal('unavailable'),
    path: portableRelativePathSchema,
    error: fsErrorSchema,
  }),
]);

export type FileContentModel = z.infer<typeof fileContentModelSchema>;
