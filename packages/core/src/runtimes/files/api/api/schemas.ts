import { hostAbsolutePathSchema, portableRelativePathSchema } from '@primitives/path/api';
import { z } from 'zod';

export const rootKeySchema = z.object({ root: hostAbsolutePathSchema });
export const pathKeySchema = rootKeySchema.extend({ relative: portableRelativePathSchema });
export const treeKeySchema = rootKeySchema.extend({ sessionId: z.string() });
export const contentKeySchema = pathKeySchema;

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

export const uploadFileInputSchema = rootKeySchema.extend({
  path: portableRelativePathSchema,
  overwrite: z.boolean().optional(),
});

export const uploadFileResultSchema = z.object({
  bytesWritten: z.number().int().nonnegative(),
});

export const createFileInputSchema = rootKeySchema.extend({
  path: portableRelativePathSchema,
  content: z.string().optional(),
});
export const createDirectoryInputSchema = rootKeySchema.extend({
  path: portableRelativePathSchema,
});
export const renameInputSchema = rootKeySchema.extend({
  from: portableRelativePathSchema,
  to: portableRelativePathSchema,
});
export const moveInputSchema = renameInputSchema;
export const copyInputSchema = renameInputSchema;
export const deleteInputSchema = rootKeySchema.extend({
  path: portableRelativePathSchema,
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
