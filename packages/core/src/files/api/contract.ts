import {
  defineContract,
  downloadFile,
  fallible,
  liveJob,
  liveModel,
  liveState,
  mutation,
} from '@emdash/wire';
import { z } from 'zod';
import { hostAbsolutePathSchema, portableRelativePathSchema } from '../../path';
import { fileContentModelSchema } from '../content/state';
import { fileTreeModelSchema } from '../tree/state';
import { fsErrorSchema } from './errors';
import {
  contentKeySchema,
  copyInputSchema,
  createDirectoryInputSchema,
  createFileInputSchema,
  deleteInputSchema,
  fileEnumerationOptionsSchema,
  fileGlobOptionsSchema,
  fileStatSchema,
  moveInputSchema,
  pathBatchSchema,
  pathKeySchema,
  pathListSchema,
  readBytesMetaSchema,
  readFileOptionsSchema,
  readTextResultSchema,
  renameInputSchema,
  rootKeySchema,
  treeKeySchema,
  writeContentInputSchema,
  writeFileInputSchema,
} from './schemas';

export const filesContract = defineContract({
  fs: defineContract({
    stat: fallible({ input: pathKeySchema, data: fileStatSchema, error: fsErrorSchema }),
    exists: fallible({ input: pathKeySchema, data: z.boolean(), error: fsErrorSchema }),
    realPath: fallible({
      input: pathKeySchema,
      data: hostAbsolutePathSchema,
      error: fsErrorSchema,
    }),
    readText: fallible({
      input: pathKeySchema.extend({ options: readFileOptionsSchema.optional() }),
      data: readTextResultSchema,
      error: fsErrorSchema,
    }),
    readBytes: downloadFile({
      input: pathKeySchema.extend({ options: readFileOptionsSchema.optional() }),
      meta: readBytesMetaSchema,
      error: fsErrorSchema,
    }),
    glob: liveJob({
      input: rootKeySchema.extend({
        patterns: z.array(z.string()),
        options: fileGlobOptionsSchema,
      }),
      progress: pathBatchSchema,
      result: pathListSchema,
      error: fsErrorSchema,
    }),
    enumerate: liveJob({
      input: pathKeySchema.extend({ options: fileEnumerationOptionsSchema.optional() }),
      progress: pathBatchSchema,
      result: pathListSchema,
      error: fsErrorSchema,
    }),
  }),
  tree: defineContract({
    model: liveModel({
      key: treeKeySchema,
      states: {
        tree: liveState({ data: fileTreeModelSchema }),
      },
      mutations: {
        expand: mutation({
          input: z.object({ path: portableRelativePathSchema }),
          data: z.void(),
          error: fsErrorSchema,
        }),
        collapse: mutation({
          input: z.object({ path: portableRelativePathSchema }),
          data: z.void(),
          error: fsErrorSchema,
        }),
        reveal: mutation({
          input: z.object({ path: portableRelativePathSchema }),
          data: z.void(),
          error: fsErrorSchema,
        }),
      },
    }),
  }),
  content: liveModel({
    key: contentKeySchema,
    states: {
      content: liveState({ data: fileContentModelSchema }),
    },
    mutations: {
      write: mutation({ input: writeContentInputSchema, data: z.void(), error: fsErrorSchema }),
    },
  }),
  mutations: defineContract({
    createFile: fallible({ input: createFileInputSchema, data: z.void(), error: fsErrorSchema }),
    createDirectory: fallible({
      input: createDirectoryInputSchema,
      data: z.void(),
      error: fsErrorSchema,
    }),
    rename: fallible({ input: renameInputSchema, data: z.void(), error: fsErrorSchema }),
    move: fallible({ input: moveInputSchema, data: z.void(), error: fsErrorSchema }),
    copy: fallible({ input: copyInputSchema, data: z.void(), error: fsErrorSchema }),
    delete: fallible({ input: deleteInputSchema, data: z.void(), error: fsErrorSchema }),
    writeFile: fallible({ input: writeFileInputSchema, data: z.void(), error: fsErrorSchema }),
  }),
});

export type FilesContract = typeof filesContract;
