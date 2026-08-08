import { resourceUriSchema } from '@emdash/core/primitives/path/api';
import {
  exclusionPatternsSchema,
  filesContract,
  MAX_FILE_UPLOAD_BYTES,
  readFileOptionsSchema,
} from '@emdash/core/runtimes/files/api';
import { defineContract, downloadFile, liveModel, liveState, uploadFile } from '@emdash/wire/rpc';
import { z } from 'zod';
import {
  runtimeFallibleMutations,
  runtimeFallibleProcedure,
  runtimeResolveErrorUnion,
} from '@core/primitives/desktop-runtime/api/fallible-contract';

// Every key in this domain is a ResourceUri — a serialized HostFileRef carrying
// the host and the absolute path (spec §2/§8). Workspace→root resolution happens
// at the renderer edge; no workspaceId reaches the wire.
const uriKeySchema = z.object({ uri: resourceUriSchema });

// The only implemented source today. A follow-up ticket widens this to
// `z.union([z.literal('disk'), z.object({ ref: gitRefSchema })])`; existing
// `{ uri, source: 'disk' }` keys stay valid under that union.
const contentSourceSchema = z.literal('disk');

const contentKeySchema = z.object({
  uri: resourceUriSchema,
  source: contentSourceSchema,
});

// `sessionId` keeps two consumers of the same root (e.g. two windows) from
// sharing one server-side tree resource and its expansion state.
const treeKeySchema = z.object({
  root: resourceUriSchema,
  sessionId: z.string(),
  exclusions: exclusionPatternsSchema,
});

const readOptionsShape = { options: readFileOptionsSchema.optional() };

const filesFsContract = defineContract({
  exists: runtimeFallibleProcedure(uriKeySchema, filesContract.fs.exists.output),
  realPath: runtimeFallibleProcedure(uriKeySchema, filesContract.fs.realPath.output),
  readText: runtimeFallibleProcedure(
    uriKeySchema.extend(readOptionsShape),
    filesContract.fs.readText.output
  ),
  readBytes: downloadFile({
    input: uriKeySchema.extend(readOptionsShape),
    meta: filesContract.fs.readBytes.meta,
    error: runtimeResolveErrorUnion(filesContract.fs.readBytes.error),
  }),
  upload: uploadFile({
    input: uriKeySchema.extend({ overwrite: z.boolean().optional() }),
    maxSize: MAX_FILE_UPLOAD_BYTES,
    result: filesContract.fs.upload.result,
    error: runtimeResolveErrorUnion(filesContract.fs.upload.error),
  }),
});

const renameKeySchema = z.object({ uri: resourceUriSchema, to: resourceUriSchema });

const filesMutationsContract = defineContract({
  createFile: runtimeFallibleProcedure(
    uriKeySchema.extend({ content: z.string().optional() }),
    filesContract.mutations.createFile.output
  ),
  createDirectory: runtimeFallibleProcedure(
    uriKeySchema,
    filesContract.mutations.createDirectory.output
  ),
  rename: runtimeFallibleProcedure(renameKeySchema, filesContract.mutations.rename.output),
  move: runtimeFallibleProcedure(renameKeySchema, filesContract.mutations.move.output),
  delete: runtimeFallibleProcedure(
    uriKeySchema.extend({ recursive: z.boolean().optional() }),
    filesContract.mutations.delete.output
  ),
});

export const filesDomain = 'files' as const;

export const filesWireContract = defineContract({
  fs: filesFsContract,
  tree: defineContract({
    model: liveModel({
      key: treeKeySchema,
      states: {
        tree: liveState({ data: filesContract.tree.model.states.tree.dataSchema }),
      },
      mutations: runtimeFallibleMutations(filesContract.tree.model.mutations),
    }),
  }),
  content: liveModel({
    key: contentKeySchema,
    states: {
      content: liveState({ data: filesContract.content.states.content.dataSchema }),
    },
    mutations: runtimeFallibleMutations(filesContract.content.mutations),
  }),
  mutations: filesMutationsContract,
});

export type FilesWireContract = typeof filesWireContract;
export type FilesContentKey = z.infer<typeof filesWireContract.content.keySchema>;
export type FilesContentModel = z.infer<typeof filesWireContract.content.states.content.dataSchema>;
export type FilesTreeKey = z.infer<typeof filesWireContract.tree.model.keySchema>;
export type FilesTreeModel = z.infer<typeof filesWireContract.tree.model.states.tree.dataSchema>;
