import { z } from 'zod';
import { hostAbsolutePathSchema, portableRelativePathSchema } from '#primitives/path/api';

export const rootKeySchema = z.object({ root: hostAbsolutePathSchema });
export const pathKeySchema = rootKeySchema.extend({ relative: portableRelativePathSchema });
export const absolutePathKeySchema = z.object({ path: hostAbsolutePathSchema });
// One file key shape for both operational modes: scoped to a registered root, or a
// bare absolute host path with no root registered (spec §3/§5).
export const fileKeySchema = z.union([pathKeySchema, absolutePathKeySchema]);
export const exclusionPatternsSchema = z.array(z.string()).optional();
export const treeKeySchema = rootKeySchema.extend({
  sessionId: z.string(),
  exclusions: exclusionPatternsSchema,
});
export const contentKeySchema = fileKeySchema;

export const fileStatSchema = z.object({
  path: portableRelativePathSchema,
  type: z.enum(['file', 'directory']),
  size: z.number().int().nonnegative(),
  mtimeMs: z.number(),
  ctimeMs: z.number(),
  mode: z.number().int(),
});

export const fileUsageErrorSchema = z.object({
  path: portableRelativePathSchema,
  message: z.string(),
});
export const fileUsageSchema = z.object({
  path: portableRelativePathSchema,
  type: z.enum(['file', 'directory']),
  apparentBytes: z.number().int().nonnegative(),
  diskBytes: z.number().int().nonnegative(),
  exclusiveDiskBytes: z.number().int().nonnegative(),
  errors: z.array(fileUsageErrorSchema),
});

export const readFileOptionsSchema = z.object({
  maxBytes: z.number().int().nonnegative().optional(),
});

export const readFileKeySchema = z.union([
  pathKeySchema.extend({ options: readFileOptionsSchema.optional() }),
  absolutePathKeySchema.extend({ options: readFileOptionsSchema.optional() }),
]);

export const readTextResultSchema = z.object({
  content: z.string(),
  truncated: z.boolean(),
  totalSize: z.number().int().nonnegative(),
  etag: z.string(),
});

export const readBytesMetaSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  size: z.number().nonnegative().optional(),
  lastModified: z.number().optional(),
  truncated: z.boolean(),
  totalSize: z.number().int().nonnegative(),
  etag: z.string(),
});

export const fileGlobOptionsSchema = z.object({
  cwd: portableRelativePathSchema,
  dot: z.boolean().optional(),
});

export const fileEnumerationOptionsSchema = z.object({
  includeSymlinkFiles: z.boolean().optional(),
});

export const pathBatchSchema = z.object({ paths: z.array(portableRelativePathSchema) });
export const pathListSchema = z.object({ paths: z.array(portableRelativePathSchema) });

export const writePreconditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('etag'), etag: z.string().min(1) }),
  z.object({ kind: z.literal('overwrite') }),
]);

export const writeContentInputSchema = z.object({
  content: z.string(),
  precondition: writePreconditionSchema,
});

// A mutation target follows the fileKeySchema duality (spec §3/§5): root-relative
// when the input carries a `root`, or a bare absolute host path with no root.
// These stay plain objects (optional `root`, target union) rather than a union of
// the two modes because downstream contracts derive from them with `.omit()`;
// mode mismatches are rejected at the runtime seam as invalid-path errors.
export const mutationTargetSchema = z.union([hostAbsolutePathSchema, portableRelativePathSchema]);
const mutationBaseSchema = z.object({ root: hostAbsolutePathSchema.optional() });

export const uploadFileInputSchema = mutationBaseSchema.extend({
  path: mutationTargetSchema,
  overwrite: z.boolean().optional(),
});

export const uploadFileResultSchema = z.object({
  bytesWritten: z.number().int().nonnegative(),
});

export const createFileInputSchema = mutationBaseSchema.extend({
  path: mutationTargetSchema,
  content: z.string().optional(),
});
export const createDirectoryInputSchema = mutationBaseSchema.extend({
  path: mutationTargetSchema,
});
export const renameInputSchema = mutationBaseSchema.extend({
  from: mutationTargetSchema,
  to: mutationTargetSchema,
});
export const moveInputSchema = renameInputSchema;
export const copyInputSchema = renameInputSchema;
export const deleteInputSchema = mutationBaseSchema.extend({
  path: mutationTargetSchema,
  recursive: z.boolean().optional(),
});
export const writeFileInputSchema = rootKeySchema.extend({
  path: portableRelativePathSchema,
  content: z.string(),
  encoding: z.enum(['utf8', 'base64']).optional(),
  precondition: writePreconditionSchema,
});

export type RootKey = z.infer<typeof rootKeySchema>;
export type PathKey = z.infer<typeof pathKeySchema>;
export type AbsolutePathKey = z.infer<typeof absolutePathKeySchema>;
export type FileKey = z.infer<typeof fileKeySchema>;
export type ReadFileKey = z.infer<typeof readFileKeySchema>;
export type ExclusionPatterns = z.infer<typeof exclusionPatternsSchema>;
export type TreeKey = z.infer<typeof treeKeySchema>;
export type ContentKey = z.infer<typeof contentKeySchema>;
export type FileStat = z.infer<typeof fileStatSchema>;
export type FileUsageError = z.infer<typeof fileUsageErrorSchema>;
export type FileUsage = z.infer<typeof fileUsageSchema>;
export type ReadFileOptions = z.infer<typeof readFileOptionsSchema>;
export type ReadTextResult = z.infer<typeof readTextResultSchema>;
export type ReadBytesMeta = z.infer<typeof readBytesMetaSchema>;
export type FileGlobOptions = z.infer<typeof fileGlobOptionsSchema>;
export type FileEnumerationOptions = z.infer<typeof fileEnumerationOptionsSchema>;
export type PathBatch = z.infer<typeof pathBatchSchema>;
export type PathList = z.infer<typeof pathListSchema>;
export type MutationTarget = z.infer<typeof mutationTargetSchema>;
export type WritePrecondition = z.infer<typeof writePreconditionSchema>;
export type WriteContentInput = z.infer<typeof writeContentInputSchema>;
export type UploadFileInput = z.infer<typeof uploadFileInputSchema>;
export type UploadFileResult = z.infer<typeof uploadFileResultSchema>;
export type CreateFileInput = z.infer<typeof createFileInputSchema>;
export type CreateDirectoryInput = z.infer<typeof createDirectoryInputSchema>;
export type RenameInput = z.infer<typeof renameInputSchema>;
export type MoveInput = z.infer<typeof moveInputSchema>;
export type CopyInput = z.infer<typeof copyInputSchema>;
export type DeleteInput = z.infer<typeof deleteInputSchema>;
export type WriteFileInput = z.infer<typeof writeFileInputSchema>;
