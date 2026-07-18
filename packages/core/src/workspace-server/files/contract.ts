import { defineContract, fallible, liveJob, liveModel, liveState } from '@emdash/wire';
import { z } from 'zod';
import {
  fileContentModelSchema,
  fileStatSchema,
  fileTreeModelSchema,
  fsErrorSchema,
  fileEnumerationOptionsSchema,
  fileGlobOptionsSchema,
  readBytesResultSchema,
  readFileOptionsSchema,
  readTextResultSchema,
} from './schemas';

const rootKey = z.object({ rootPath: z.string() });
const pathKey = z.object({ rootPath: z.string(), path: z.string() });

// Tree is per-session: sessionId is part of the model key (required on all tree procedures).
// Each session maintains its own expanded/loaded subtree. One shared fs watcher per rootPath
// fans out to all session models (watcher refcounted by rootPath; models by (rootPath, sessionId)).
const treeKey = z.object({ rootPath: z.string(), sessionId: z.string() });
const treePathKey = treeKey.extend({ path: z.string() });

// Content is shared per (rootPath, path). sessionId is an optional lease tag only —
// content has no per-session divergence, so it is not part of the model key.
const contentKey = z.object({
  rootPath: z.string(),
  path: z.string(),
  sessionId: z.string().optional(),
});

const fsContract = defineContract({
  stat: fallible({
    input: pathKey,
    data: fileStatSchema,
    error: fsErrorSchema,
  }),

  exists: fallible({
    input: pathKey,
    data: z.boolean(),
    error: fsErrorSchema,
  }),

  realPath: fallible({
    input: pathKey,
    data: z.string(),
    error: fsErrorSchema,
  }),

  readText: fallible({
    input: pathKey.extend({ options: readFileOptionsSchema.optional() }),
    data: readTextResultSchema,
    error: fsErrorSchema,
  }),

  /**
   * bytes is base64 on the wire (intentional wire divergence from readBytes(Uint8Array)).
   */
  readBytes: fallible({
    input: pathKey.extend({ options: readFileOptionsSchema.optional() }),
    data: readBytesResultSchema,
    error: fsErrorSchema,
  }),

  /**
   * Streams matched paths as live-job progress batches.
   * exclude predicate is dropped from the wire; use FileGlobOptions.cwd and dot.
   */
  glob: liveJob({
    input: rootKey.extend({ patterns: z.array(z.string()), options: fileGlobOptionsSchema }),
    progress: z.object({ paths: z.array(z.string()) }),
    result: z.object({ paths: z.array(z.string()) }),
    error: fsErrorSchema,
  }),

  /**
   * Streams file paths under the given directory as live-job progress batches.
   * The exclude predicate is dropped from the wire (not serializable).
   */
  enumerate: liveJob({
    input: pathKey.extend({ options: fileEnumerationOptionsSchema.optional() }),
    progress: z.object({ paths: z.array(z.string()) }),
    result: z.object({ paths: z.array(z.string()) }),
    error: fsErrorSchema,
  }),
});

const treeContract = defineContract({
  model: liveModel({
    key: treeKey,
    states: {
      tree: liveState({ data: fileTreeModelSchema }),
    },
  }),

  /**
   * Loads a directory's children into this session's tree model.
   * Sets childrenLoaded=true and populates children[] on the dir entry.
   * The resulting patch flows over the subscribe stream.
   */
  expand: fallible({
    input: treePathKey,
    data: z.void(),
    error: fsErrorSchema,
  }),

  /**
   * Prunes a directory's children from this session's tree model.
   * Sets childrenLoaded=false and clears children[] on the dir entry.
   * The resulting patch flows over the subscribe stream.
   */
  collapse: fallible({
    input: treePathKey,
    data: z.void(),
    error: fsErrorSchema,
  }),

  /**
   * Ensures all ancestor directories of `path` are loaded in this session's model.
   * Useful for reveal-in-tree operations.
   */
  reveal: fallible({
    input: treePathKey,
    data: z.void(),
    error: fsErrorSchema,
  }),
});

const contentContract = liveModel({
  key: contentKey,
  states: {
    content: liveState({ data: fileContentModelSchema }),
  },
});

const mutationsContract = defineContract({
  createFile: fallible({
    input: rootKey.extend({ path: z.string(), content: z.string().optional() }),
    data: z.void(),
    error: fsErrorSchema,
  }),

  createDirectory: fallible({
    input: rootKey.extend({ path: z.string() }),
    data: z.void(),
    error: fsErrorSchema,
  }),

  rename: fallible({
    input: rootKey.extend({ from: z.string(), to: z.string() }),
    data: z.void(),
    error: fsErrorSchema,
  }),

  move: fallible({
    input: rootKey.extend({ from: z.string(), to: z.string() }),
    data: z.void(),
    error: fsErrorSchema,
  }),

  copy: fallible({
    input: rootKey.extend({ from: z.string(), to: z.string() }),
    data: z.void(),
    error: fsErrorSchema,
  }),

  delete: fallible({
    input: rootKey.extend({ path: z.string(), recursive: z.boolean().optional() }),
    data: z.void(),
    error: fsErrorSchema,
  }),

  writeFile: fallible({
    input: rootKey.extend({
      path: z.string(),
      content: z.string(),
      encoding: z.enum(['utf8', 'base64']).optional(),
    }),
    data: z.void(),
    error: fsErrorSchema,
  }),
});

export const filesContract = defineContract({
  fs: fsContract,
  tree: treeContract,
  content: contentContract,
  mutations: mutationsContract,
});

export type FilesContract = typeof filesContract;
