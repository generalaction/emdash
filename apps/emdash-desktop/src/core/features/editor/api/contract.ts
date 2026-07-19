import { filesContract, MAX_FILE_UPLOAD_BYTES } from '@emdash/core/runtimes/files/api';
import {
  defineContract,
  downloadFile,
  liveModel,
  liveState,
  procedure,
  uploadFile,
} from '@emdash/wire';
import { z } from 'zod';
import {
  runtimeFallibleMutations,
  runtimeFallibleProcedure,
  runtimeResolveErrorUnion,
} from '@core/features/runtime-routing/api/fallible-contract';

const workspaceKeySchema = z.object({ workspaceId: z.string() });
const treeKeySchema = workspaceKeySchema.extend({ sessionId: z.string() });
const pathKeySchema = filesContract.fs.exists.input
  .omit({ root: true })
  .extend(workspaceKeySchema.shape);

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
    filesContract.fs.readText.input.omit({ root: true }).extend(workspaceKeySchema.shape),
    filesContract.fs.readText.output
  ),
  readBytes: downloadFile({
    input: filesContract.fs.readBytes.input.omit({ root: true }).extend(workspaceKeySchema.shape),
    meta: filesContract.fs.readBytes.meta,
    error: runtimeResolveErrorUnion(filesContract.fs.readBytes.error),
  }),
  upload: uploadFile({
    input: filesContract.fs.upload.input.omit({ root: true }).extend(workspaceKeySchema.shape),
    maxSize: MAX_FILE_UPLOAD_BYTES,
    result: filesContract.fs.upload.result,
    error: runtimeResolveErrorUnion(filesContract.fs.upload.error),
  }),
});

const editorMutationsContract = defineContract({
  createFile: runtimeFallibleProcedure(
    filesContract.mutations.createFile.input.omit({ root: true }).extend(workspaceKeySchema.shape),
    filesContract.mutations.createFile.output
  ),
  createDirectory: runtimeFallibleProcedure(
    filesContract.mutations.createDirectory.input
      .omit({ root: true })
      .extend(workspaceKeySchema.shape),
    filesContract.mutations.createDirectory.output
  ),
  rename: runtimeFallibleProcedure(
    filesContract.mutations.rename.input.omit({ root: true }).extend(workspaceKeySchema.shape),
    filesContract.mutations.rename.output
  ),
  move: runtimeFallibleProcedure(
    filesContract.mutations.move.input.omit({ root: true }).extend(workspaceKeySchema.shape),
    filesContract.mutations.move.output
  ),
  delete: runtimeFallibleProcedure(
    filesContract.mutations.delete.input.omit({ root: true }).extend(workspaceKeySchema.shape),
    filesContract.mutations.delete.output
  ),
});

const editorBufferLocationSchema = z.object({
  projectId: z.string(),
  workspaceId: z.string(),
  filePath: z.string(),
});

export const editorContract = defineContract({
  fs: editorFsContract,
  tree: editorTreeContract,
  content: liveModel({
    key: filesContract.content.keySchema.omit({ root: true }).extend(workspaceKeySchema.shape),
    states: {
      content: liveState({ data: filesContract.content.states.content.dataSchema }),
    },
    mutations: runtimeFallibleMutations(filesContract.content.mutations),
  }),
  mutations: editorMutationsContract,
  saveBuffer: procedure({
    input: editorBufferLocationSchema.extend({ content: z.string() }),
    output: z.void(),
  }),
  clearBuffer: procedure({
    input: editorBufferLocationSchema,
    output: z.void(),
  }),
  listBuffers: procedure({
    input: workspaceKeySchema.extend({ projectId: z.string() }),
    output: z.array(z.object({ filePath: z.string(), content: z.string() })),
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
