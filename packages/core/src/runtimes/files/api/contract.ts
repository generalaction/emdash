import {
  defineContract,
  downloadFile,
  fallible,
  liveJob,
  liveModel,
  liveState,
  mutation,
  procedure,
  uploadFile,
} from '@emdash/wire/rpc';
import { z } from 'zod';
import { hostAbsolutePathSchema } from '#primitives/path/api';
import { fileContentModelSchema } from '#runtimes/files/api/content/state';
import { folderListingSchema } from '#runtimes/files/api/listing/state';
import { fsErrorSchema } from './errors';
import {
  absolutePathKeySchema,
  contentKeySchema,
  createDirectoryInputSchema,
  createFileInputSchema,
  deleteInputSchema,
  directoryListResultSchema,
  fileEnumerationOptionsSchema,
  fileStatSchema,
  fromToKeySchema,
  homeDirectoryResultSchema,
  listingKeySchema,
  pathBatchSchema,
  pathListSchema,
  readBytesMetaSchema,
  readFileKeySchema,
  readTextResultSchema,
  uploadFileInputSchema,
  uploadFileResultSchema,
  writeContentInputSchema,
  writeFileInputSchema,
} from './schemas';

export const MAX_FILE_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * The stateless filesystem plane (spec §3.4): reads and writes keyed by a bare
 * host-absolute path. Successful mutations are reflected into affected live
 * folder listings at ack time (synchronous republish) — the fs watcher covers
 * external changes only.
 */
export const filesContract = defineContract({
  getHomeDir: procedure({
    input: z.void().optional(),
    output: homeDirectoryResultSchema,
  }),
  fs: defineContract({
    stat: fallible({ input: absolutePathKeySchema, data: fileStatSchema, error: fsErrorSchema }),
    exists: fallible({
      input: absolutePathKeySchema,
      data: z.object({ exists: z.boolean() }),
      error: fsErrorSchema,
    }),
    realPath: fallible({
      input: absolutePathKeySchema,
      data: z.object({ path: hostAbsolutePathSchema }),
      error: fsErrorSchema,
    }),
    readText: fallible({
      input: readFileKeySchema,
      data: readTextResultSchema,
      error: fsErrorSchema,
    }),
    readBytes: downloadFile({
      input: readFileKeySchema,
      meta: readBytesMetaSchema,
      error: fsErrorSchema,
    }),
    upload: uploadFile({
      input: uploadFileInputSchema,
      maxSize: MAX_FILE_UPLOAD_BYTES,
      result: uploadFileResultSchema,
      error: fsErrorSchema,
    }),
    enumerate: liveJob({
      input: absolutePathKeySchema.extend({ options: fileEnumerationOptionsSchema.optional() }),
      progress: pathBatchSchema,
      result: pathListSchema,
      error: fsErrorSchema,
    }),
    createFile: fallible({ input: createFileInputSchema, data: z.void(), error: fsErrorSchema }),
    createDirectory: fallible({
      input: createDirectoryInputSchema,
      data: z.void(),
      error: fsErrorSchema,
    }),
    writeFile: fallible({ input: writeFileInputSchema, data: z.void(), error: fsErrorSchema }),
    rename: fallible({ input: fromToKeySchema, data: z.void(), error: fsErrorSchema }),
    move: fallible({ input: fromToKeySchema, data: z.void(), error: fsErrorSchema }),
    copy: fallible({ input: fromToKeySchema, data: z.void(), error: fsErrorSchema }),
    delete: fallible({ input: deleteInputSchema, data: z.void(), error: fsErrorSchema }),
    /** One-shot listing with sizes, timestamps and repository detection, for folder browsers. */
    listDirectory: fallible({
      input: absolutePathKeySchema,
      data: directoryListResultSchema,
      error: fsErrorSchema,
    }),
  }),
  // Live listing of one folder in a workspace root. Subscribing to a folder is
  // what loads it: the host keeps one watched listing per folder for every
  // subscriber, and drops it shortly after the last one leaves.
  listing: liveModel({
    key: listingKeySchema,
    states: {
      listing: liveState({ data: folderListingSchema }),
    },
    mutations: {
      /** Rereads this folder and every listed folder beneath it, for when the watcher misses changes. */
      refresh: mutation({
        input: z.void().optional(),
        data: z.void(),
        error: fsErrorSchema,
      }),
    },
  }),
  // Live file content keyed by a bare host-absolute path (spec §3.4). Every
  // session is per-file watched by watching the file's parent directory, so
  // files outside any registered root — external files — get live updates
  // too. Unreadable content reports the closed seam-error enum; `write` is
  // the etag-preconditioned editor write path (a stale etag rejects with
  // `etag-mismatch`).
  content: liveModel({
    key: contentKeySchema,
    states: {
      content: liveState({ data: fileContentModelSchema }),
    },
    mutations: {
      write: mutation({ input: writeContentInputSchema, data: z.void(), error: fsErrorSchema }),
    },
  }),
});

export type FilesContract = typeof filesContract;
