import { z } from 'zod';
import { liveValue } from '../shared/schemas';

// ---------------------------------------------------------------------------
// FS types
// ---------------------------------------------------------------------------

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
});

/**
 * On the wire, `bytes` is represented as a base64-encoded string rather than Uint8Array.
 * Uint8Array is not natively serializable by the oRPC RPC serializer.
 * Adapters on both sides must convert between Uint8Array and base64.
 *
 * Intentional wire divergence from ReadBytesResult.bytes (Uint8Array → base64 string).
 */
export const readBytesResultSchema = z.object({
  bytes: z.string(), // base64 on the wire; adapters convert to/from Uint8Array
  truncated: z.boolean(),
  totalSize: z.number().int(),
});

export const writeFileResultSchema = z.object({
  bytesWritten: z.number().int(),
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

// ---------------------------------------------------------------------------
// File tree types
// ---------------------------------------------------------------------------

export const fileSymlinkTargetTypeSchema = z.enum(['file', 'directory', 'other', 'unknown']);

export const fileSymlinkInfoSchema = z.object({
  targetPath: z.string().optional(),
  realPath: z.string().optional(),
  targetType: fileSymlinkTargetTypeSchema,
  broken: z.boolean(),
});

export const fileNodeTypeSchema = z.enum(['file', 'directory', 'symlink']);

export const nodeIdSchema = z.number().int();

const directoryPreviewSegmentSchema = z.object({
  name: z.string(),
  path: z.string(),
});

const directoryPreviewSchema = z.object({
  childCount: z.number().int(),
  singleChildDirectoryChain: z.array(directoryPreviewSegmentSchema),
});

const fileNodeBaseSchema = z.object({
  id: nodeIdSchema,
  path: z.string(),
  name: z.string(),
  parentId: nodeIdSchema.nullable(),
  childrenLoaded: z.boolean(),
  directoryPreview: directoryPreviewSchema.optional(),
});

export const fileNodeSchema = z.union([
  fileNodeBaseSchema.extend({
    type: z.enum(['file', 'directory']),
  }),
  fileNodeBaseSchema.extend({
    type: z.literal('symlink'),
    symlink: fileSymlinkInfoSchema,
  }),
]);

// ---------------------------------------------------------------------------
// Collection primitives (KeyedOp, Snapshot, Update) for FileTree
// ---------------------------------------------------------------------------

const keyedOpSchema = <K extends z.ZodTypeAny, V extends z.ZodTypeAny>(key: K, value: V) =>
  z.union([
    z.object({ op: z.literal('put'), key, value }),
    z.object({ op: z.literal('del'), key }),
  ]);

export const fileTreeSnapshotSchema = z.object({
  entries: z.array(z.tuple([nodeIdSchema, fileNodeSchema])),
  generation: z.number().int(),
  sequence: z.number().int(),
});

export const fileTreeUpdateSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('snapshot'),
    entries: z.array(z.tuple([nodeIdSchema, fileNodeSchema])),
    generation: z.number().int(),
    sequence: z.number().int(),
  }),
  z.object({
    kind: z.literal('delta'),
    generation: z.number().int(),
    ops: z.array(keyedOpSchema(nodeIdSchema, fileNodeSchema)),
    sequence: z.number().int(),
  }),
]);

export const fileTreeSequencesSchema = z.object({
  tree: z.number().int().optional(),
});

// ---------------------------------------------------------------------------
// File changes types
// ---------------------------------------------------------------------------

export const fileEntryTypeSchema = z.enum(['file', 'directory', 'symlink', 'unknown']);

export const fileChangeKindSchema = z.enum(['create', 'update', 'delete']);

export const fileChangeSchema = z.object({
  kind: fileChangeKindSchema,
  path: z.string(),
  entryType: fileEntryTypeSchema,
});

export const fileChangeUpdateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('changes'), changes: z.array(fileChangeSchema) }),
  z.object({ kind: z.literal('resync') }),
]);

/**
 * Wire shape of FileChangeWatchOptions. The `exclude` predicate function is dropped
 * (cannot be serialized). The `paths` allow-list is preserved.
 */
export const fileChangeWatchOptionsSchema = z.object({
  paths: z.array(z.string()).optional(),
  debounceMs: z.number().int().optional(),
});

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export const fileErrorSchema = z.union([
  z.object({ type: z.literal('invalid-path'), path: z.string(), message: z.string() }),
  z.object({
    type: z.literal('fs-error'),
    path: z.string(),
    message: z.string(),
    code: z.string().optional(),
  }),
]);

export const fileTreeErrorSchema = z.union([
  z.object({ type: z.literal('invalid-path'), path: z.string(), message: z.string() }),
  z.object({
    type: z.literal('not-found'),
    id: nodeIdSchema.optional(),
    path: z.string().optional(),
  }),
  z.object({ type: z.literal('not-directory'), id: nodeIdSchema.optional(), path: z.string() }),
  z.object({ type: z.literal('fs-error'), path: z.string(), message: z.string() }),
]);

// FileTree LiveValue snapshots (used by openTree response and subscribe streams)
export const fileTreeLiveSnapshotSchema = liveValue(fileTreeSnapshotSchema);
