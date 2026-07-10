import { z } from 'zod';
import { parsePortableRelativePath } from './relative';
import { hostId } from './resource';
import { decodeResourceUri } from './resource-uri';
import type { HostId, PortableRelativePath, ResourceKey, ResourceUri } from './types';

export const hostIdSchema = z
  .string()
  .refine((value) => hostId(value).success, {
    message: 'Invalid host id',
  })
  .transform((value) => value as HostId);

export const portableRelativePathSchema = z
  .string()
  .refine((value) => parsePortableRelativePath(value).success, {
    message: 'Invalid portable relative path',
  })
  .transform((value) => value as PortableRelativePath);

export const pathProfileSchema = z.object({
  style: z.enum(['posix', 'win32']),
  caseSensitivity: z.enum(['sensitive', 'insensitive']),
  unicodeNormalization: z.enum(['preserve', 'nfc']),
});

export const posixPathRootSchema = z.object({
  kind: z.literal('posix'),
});

export const drivePathRootSchema = z.object({
  kind: z.literal('drive'),
  driveLetter: z.string().regex(/^[A-Z]$/u),
});

export const uncPathRootSchema = z.object({
  kind: z.literal('unc'),
  server: z.string().min(1),
  share: z.string().min(1),
});

export const hostPathRootSchema = z.discriminatedUnion('kind', [
  posixPathRootSchema,
  drivePathRootSchema,
  uncPathRootSchema,
]);

export const hostAbsolutePathSchema = z.object({
  root: hostPathRootSchema,
  segments: z.array(z.string().min(1)),
});

export const hostFileRefSchema = z.object({
  hostId: hostIdSchema,
  path: hostAbsolutePathSchema,
});

export const scopedPathSchema = z.object({
  root: hostFileRefSchema,
  relative: portableRelativePathSchema,
});

export const resourceUriSchema = z
  .string()
  .refine((value) => decodeResourceUri(value).success, {
    message: 'Invalid resource URI',
  })
  .transform((value) => value as ResourceUri);

export const resourceKeySchema = z
  .string()
  .min(1)
  .transform((value) => value as ResourceKey);
