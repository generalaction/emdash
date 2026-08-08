import { z } from 'zod';
import { portableRelativePathSchema } from '#primitives/path/api';
import { fsErrorSchema } from '#runtimes/files/api/api/errors';

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
  }),
  fileContentBaseSchema.extend({
    kind: z.literal('binary'),
    mimeType: z.string().optional(),
  }),
  // Over-limit files classify as too-large instead of truncating silently (spec §3).
  z.object({
    kind: z.literal('too-large'),
    path: portableRelativePathSchema,
    byteSize: z.number().int().nonnegative(),
    limit: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('unavailable'),
    path: portableRelativePathSchema,
    error: fsErrorSchema,
  }),
]);

export type FileContentModel = z.infer<typeof fileContentModelSchema>;
