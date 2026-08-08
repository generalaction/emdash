import { resourceUriSchema } from '@emdash/core/primitives/path/api';
import {
  exclusionPatternsSchema,
  filesContract,
  MAX_FILE_UPLOAD_BYTES,
  pathKeySchema as filesPathKeySchema,
  readFileOptionsSchema,
} from '@emdash/core/runtimes/files/api';
import {
  defineContract,
  downloadFile,
  liveModel,
  liveState,
  procedure,
  uploadFile,
} from '@emdash/wire/rpc';
import { z } from 'zod';
import {
  runtimeFallibleMutations,
  runtimeFallibleProcedure,
  runtimeResolveErrorUnion,
} from '@core/primitives/desktop-runtime/api/fallible-contract';

const workspaceKeySchema = z.object({ workspaceId: z.string() });
const treeKeySchema = workspaceKeySchema.extend({
  sessionId: z.string(),
  exclusions: exclusionPatternsSchema,
});
// The files runtime `fs` surface is keyed by host-absolute paths; the editor
// domain stays workspace-scoped, so its keys carry a workspace-relative path
// that the controller resolves to an absolute path at the seam.
const pathKeySchema = filesPathKeySchema.omit({ root: true }).extend(workspaceKeySchema.shape);

const editorTreeContract = defineContract({
  model: liveModel({
    key: treeKeySchema,
    states: {
      tree: liveState({ data: filesContract.tree.model.states.tree.dataSchema }),
    },
    mutations: runtimeFallibleMutations(filesContract.tree.model.mutations),
  }),
});

const editorFsContract = defineContract({
  exists: runtimeFallibleProcedure(pathKeySchema, filesContract.fs.exists.output),
  realPath: runtimeFallibleProcedure(pathKeySchema, filesContract.fs.realPath.output),
  readText: runtimeFallibleProcedure(
    pathKeySchema.extend({ options: readFileOptionsSchema.optional() }),
    filesContract.fs.readText.output
  ),
  readBytes: downloadFile({
    input: pathKeySchema.extend({ options: readFileOptionsSchema.optional() }),
    meta: filesContract.fs.readBytes.meta,
    error: runtimeResolveErrorUnion(filesContract.fs.readBytes.error),
  }),
  upload: uploadFile({
    input: pathKeySchema.extend({ overwrite: z.boolean().optional() }),
    maxSize: MAX_FILE_UPLOAD_BYTES,
    result: filesContract.fs.upload.result,
    error: runtimeResolveErrorUnion(filesContract.fs.upload.error),
  }),
  createDirectory: runtimeFallibleProcedure(pathKeySchema, filesContract.fs.createDirectory.output),
  delete: runtimeFallibleProcedure(
    pathKeySchema.extend({ recursive: z.boolean().optional() }),
    filesContract.fs.delete.output
  ),
});

const editorBufferKeySchema = z.object({ uri: resourceUriSchema });

export const editorDomain = 'editor' as const;

export const editorContract = defineContract({
  fs: editorFsContract,
  tree: editorTreeContract,
  content: liveModel({
    key: pathKeySchema,
    states: {
      content: liveState({ data: filesContract.content.states.content.dataSchema }),
    },
    mutations: runtimeFallibleMutations(filesContract.content.mutations),
  }),
  saveBuffer: procedure({
    input: editorBufferKeySchema.extend({ content: z.string() }),
    output: z.void(),
  }),
  clearBuffer: procedure({
    input: editorBufferKeySchema,
    output: z.void(),
  }),
  // Recovery enumeration: `root` scopes to buffers under that root ResourceUri
  // prefix; omitting it lists every buffer, including files outside any root.
  listBuffers: procedure({
    input: z.object({ root: resourceUriSchema.optional() }),
    output: z.array(z.object({ uri: resourceUriSchema, content: z.string() })),
  }),
});

export const MAX_EDITOR_FILE_UPLOAD_BYTES = MAX_FILE_UPLOAD_BYTES;

export type EditorContract = typeof editorContract;
export type EditorFileContentModel = z.infer<
  typeof editorContract.content.states.content.dataSchema
>;
export type EditorFileTreeModel = z.infer<typeof editorContract.tree.model.states.tree.dataSchema>;
export type EditorFileEntry = EditorFileTreeModel['entries'][string];
export type EditorFileEntryKind = EditorFileEntry['kind'];
export type EditorSymlinkTargetKind = NonNullable<EditorFileEntry['symlinkTargetKind']>;
