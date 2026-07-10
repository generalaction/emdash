import { z } from 'zod';

export const rootKeySchema = z.object({ rootPath: z.string() });
export const pathKeySchema = rootKeySchema.extend({ path: z.string() });
export const treeKeySchema = rootKeySchema.extend({ sessionId: z.string() });
export const contentKeySchema = pathKeySchema;

export const fileStatSchema = z.object({
  path: z.string(),
  type: z.enum(['file', 'directory']),
  size: z.number().int().nonnegative(),
  mtimeMs: z.number(),
  ctimeMs: z.number(),
  mode: z.number().int(),
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
  cwd: z.string(),
  dot: z.boolean().optional(),
});

export const fileEnumerationOptionsSchema = z.object({
  includeSymlinkFiles: z.boolean().optional(),
});

export const pathBatchSchema = z.object({ paths: z.array(z.string()) });
export const pathListSchema = z.object({ paths: z.array(z.string()) });

export const createFileInputSchema = rootKeySchema.extend({
  path: z.string(),
  content: z.string().optional(),
});
export const createDirectoryInputSchema = rootKeySchema.extend({ path: z.string() });
export const renameInputSchema = rootKeySchema.extend({
  from: z.string(),
  to: z.string(),
});
export const moveInputSchema = renameInputSchema;
export const copyInputSchema = renameInputSchema;
export const deleteInputSchema = rootKeySchema.extend({
  path: z.string(),
  recursive: z.boolean().optional(),
});
export const writeFileInputSchema = rootKeySchema.extend({
  path: z.string(),
  content: z.string(),
  encoding: z.enum(['utf8', 'base64']).optional(),
});

export type RootKey = z.infer<typeof rootKeySchema>;
export type PathKey = z.infer<typeof pathKeySchema>;
export type TreeKey = z.infer<typeof treeKeySchema>;
export type ContentKey = z.infer<typeof contentKeySchema>;
export type FileStat = z.infer<typeof fileStatSchema>;
export type ReadFileOptions = z.infer<typeof readFileOptionsSchema>;
export type ReadTextResult = z.infer<typeof readTextResultSchema>;
export type ReadBytesMeta = z.infer<typeof readBytesMetaSchema>;
export type FileGlobOptions = z.infer<typeof fileGlobOptionsSchema>;
export type FileEnumerationOptions = z.infer<typeof fileEnumerationOptionsSchema>;
export type PathBatch = z.infer<typeof pathBatchSchema>;
export type PathList = z.infer<typeof pathListSchema>;
export type CreateFileInput = z.infer<typeof createFileInputSchema>;
export type CreateDirectoryInput = z.infer<typeof createDirectoryInputSchema>;
export type RenameInput = z.infer<typeof renameInputSchema>;
export type MoveInput = z.infer<typeof moveInputSchema>;
export type CopyInput = z.infer<typeof copyInputSchema>;
export type DeleteInput = z.infer<typeof deleteInputSchema>;
export type WriteFileInput = z.infer<typeof writeFileInputSchema>;
