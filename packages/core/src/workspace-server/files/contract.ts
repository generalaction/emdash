import { eventIterator, oc } from '@orpc/contract';
import { z } from 'zod';
import { createLiveModelContract } from '../../live-model';
import { result } from '../shared/schemas';
import {
  fileContentModelSchema,
  fileStatSchema,
  fileTreeModelSchema,
  fsErrorSchema,
  fsVoidResultSchema,
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

const fsContract = {
  stat: oc.input(pathKey).output(result(fileStatSchema, fsErrorSchema)),

  exists: oc.input(pathKey).output(result(z.boolean(), fsErrorSchema)),

  realPath: oc.input(pathKey).output(result(z.string(), fsErrorSchema)),

  readText: oc
    .input(pathKey.extend({ options: readFileOptionsSchema.optional() }))
    .output(result(readTextResultSchema, fsErrorSchema)),

  /**
   * bytes is base64 on the wire (intentional wire divergence from readBytes(Uint8Array)).
   */
  readBytes: oc
    .input(pathKey.extend({ options: readFileOptionsSchema.optional() }))
    .output(result(readBytesResultSchema, fsErrorSchema)),

  /**
   * Streams matched paths as an event iterator (models AsyncIterable<string>).
   * exclude predicate is dropped from the wire; use FileGlobOptions.cwd and dot.
   */
  glob: oc
    .input(rootKey.extend({ patterns: z.array(z.string()), options: fileGlobOptionsSchema }))
    .output(eventIterator(z.string())),

  /**
   * Streams file paths under the given directory as an event iterator.
   * The exclude predicate is dropped from the wire (not serializable).
   */
  enumerate: oc
    .input(pathKey.extend({ options: fileEnumerationOptionsSchema.optional() }))
    .output(eventIterator(z.string())),
};

const treeContract = {
  ...createLiveModelContract(fileTreeModelSchema, {
    snapshotInput: treeKey,
    subscribeInput: treeKey,
    unsubscribeInput: treeKey,
  }),

  /**
   * Loads a directory's children into this session's tree model.
   * Sets childrenLoaded=true and populates children[] on the dir entry.
   * The resulting patch flows over the subscribe stream.
   */
  expand: oc.input(treePathKey).output(fsVoidResultSchema),

  /**
   * Prunes a directory's children from this session's tree model.
   * Sets childrenLoaded=false and clears children[] on the dir entry.
   * The resulting patch flows over the subscribe stream.
   */
  collapse: oc.input(treePathKey).output(fsVoidResultSchema),

  /**
   * Ensures all ancestor directories of `path` are loaded in this session's model.
   * Useful for reveal-in-tree operations.
   */
  reveal: oc.input(treePathKey).output(fsVoidResultSchema),
};

const contentContract = createLiveModelContract(fileContentModelSchema, {
  snapshotInput: contentKey,
  subscribeInput: contentKey,
  unsubscribeInput: contentKey,
});

const mutationsContract = {
  createFile: oc
    .input(rootKey.extend({ path: z.string(), content: z.string().optional() }))
    .output(fsVoidResultSchema),

  createDirectory: oc.input(rootKey.extend({ path: z.string() })).output(fsVoidResultSchema),

  rename: oc.input(rootKey.extend({ from: z.string(), to: z.string() })).output(fsVoidResultSchema),

  move: oc.input(rootKey.extend({ from: z.string(), to: z.string() })).output(fsVoidResultSchema),

  copy: oc.input(rootKey.extend({ from: z.string(), to: z.string() })).output(fsVoidResultSchema),

  delete: oc
    .input(rootKey.extend({ path: z.string(), recursive: z.boolean().optional() }))
    .output(fsVoidResultSchema),

  writeFile: oc
    .input(
      rootKey.extend({
        path: z.string(),
        content: z.string(),
        encoding: z.enum(['utf8', 'base64']).optional(),
      })
    )
    .output(fsVoidResultSchema),
};

export const filesContract = {
  fs: fsContract,
  tree: treeContract,
  content: contentContract,
  mutations: mutationsContract,
};

export type FilesContract = typeof filesContract;
