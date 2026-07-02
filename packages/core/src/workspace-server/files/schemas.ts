import { z } from 'zod';
import { result } from '../shared/schemas';

export const fileStatSchema = z.object({
  path: z.string(),
  type: z.enum(['file', 'directory']),
  size: z.number().int(),
  mtime: z.date(),
  ctime: z.date(),
  mode: z.number().int(),
});

export const readFileOptionsSchema = z.object({
  maxBytes: z.number().int().optional(),
});

export const readTextResultSchema = z.object({
  content: z.string(),
  truncated: z.boolean(),
  totalSize: z.number().int(),
  etag: z.string(),
});

/**
 * oRPC natively supports Blob — when returned inside an object it is transparently
 * serialized as FormData by the RPC serializer. No base64 adapter needed on either side.
 */
export const readBytesResultSchema = z.object({
  bytes: z.instanceof(Blob),
  truncated: z.boolean(),
  totalSize: z.number().int(),
  etag: z.string(),
});

export const fileGlobOptionsSchema = z.object({
  cwd: z.string(),
  dot: z.boolean().optional(),
});

/**
 * Wire shape of FileEnumerationOptions. The `exclude` predicate function is dropped
 * from the wire contract (it cannot be serialized). Adapters implement exclusion
 * server-side or accept serializable patterns in a follow-up extension.
 */
export const fileEnumerationOptionsSchema = z.object({
  includeSymlinkFiles: z.boolean().optional(),
});

export const fsErrorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('not-found'), path: z.string() }),
  z.object({ type: z.literal('permission-denied'), path: z.string() }),
  z.object({ type: z.literal('already-exists'), path: z.string() }),
  z.object({ type: z.literal('not-a-directory'), path: z.string() }),
  z.object({ type: z.literal('is-a-directory'), path: z.string() }),
  z.object({ type: z.literal('invalid-path'), path: z.string(), message: z.string() }),
  z.object({ type: z.literal('io'), path: z.string(), message: z.string() }),
]);

export type FsError = z.infer<typeof fsErrorSchema>;

/**
 * The single result type for all mutations and for expand/collapse/reveal.
 * No sequence is returned — clients trust the tree/content LiveModel streams
 * to reflect changes via the fs watcher.
 */
export const fsVoidResultSchema = result(z.void(), fsErrorSchema);

export const fileEntryKindSchema = z.enum(['file', 'directory', 'symlink']);

/**
 * A single node in the normalized file tree.
 *
 * Paths are POSIX root-relative (e.g. 'src/index.ts'). The root node itself
 * uses the key '' (empty string). Absolute paths appear only at the FS runtime
 * boundary (server joins root + relPath).
 *
 * `children` is server-ordered (dirs-first, case-insensitive locale) and contains
 * root-relative sibling paths. It is an empty array until `childrenLoaded` is true.
 *
 * `etag` is mtime+size based (VSCode style) and can be used for content-staleness
 * detection; it is absent for directories.
 */
export const fileEntrySchema = z.object({
  path: z.string(),
  name: z.string(),
  parentPath: z.string().nullable(),
  kind: fileEntryKindSchema,
  childrenLoaded: z.boolean(),
  children: z.array(z.string()),
  hasChildren: z.boolean().optional(),
  etag: z.string().optional(),
  size: z.number().int().optional(),
  mtimeMs: z.number().optional(),
  symlinkTarget: z.string().nullable().optional(),
});

export type FileEntry = z.infer<typeof fileEntrySchema>;

/**
 * The normalized file tree model.
 *
 * `root` is the absolute POSIX path of the workspace root (e.g. '/home/user/repo').
 * `entries` is a Record keyed by root-relative POSIX paths; the root itself is at key ''.
 *
 * Each directory entry has `childrenLoaded: false` and `children: []` until
 * `tree.expand` is called. The client's refcount wrapper calls `expand`/`collapse`
 * when views open/close directories.
 */
export const fileTreeModelSchema = z.object({
  root: z.string(),
  entries: z.record(z.string(), fileEntrySchema),
});

export type FileTreeModel = z.infer<typeof fileTreeModelSchema>;

/**
 * Shared fields present on both text and binary content models.
 *
 * `etag` is the VSCode-style staleness token (mtime.toString(29) + size.toString(31)).
 * Clients use it to detect whether a file changed on disk and, for binary files,
 * as a cache key when deciding whether to re-fetch via `fs.readBytes`.
 */
const fileContentBaseSchema = z.object({
  path: z.string(),
  etag: z.string(),
  byteSize: z.number().int(),
  readonly: z.boolean(),
});

/**
 * Live model for the contents of a single open file. Discriminated by `kind`:
 *
 * - `text`: carries the decoded text content directly. Immer patches the `content`
 *   string on external saves. `truncated` is true when the server capped the read.
 *
 * - `binary`: carries only metadata (etag, byteSize, mimeType). Raw bytes are never
 *   included in the LiveModel stream — clients fetch them on demand via `fs.readBytes`,
 *   using `etag` for cache validation to skip redundant fetches.
 */
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
]);

export type FileContentModel = z.infer<typeof fileContentModelSchema>;
