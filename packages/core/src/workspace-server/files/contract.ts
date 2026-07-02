import { eventIterator, oc } from '@orpc/contract';
import { z } from 'zod';
import { result } from '../shared/schemas';
import {
  fileChangeUpdateSchema,
  fileChangeWatchOptionsSchema,
  fileEnumerationOptionsSchema,
  fileErrorSchema,
  fileGlobOptionsSchema,
  fileNodeSchema,
  fileStatSchema,
  fileTreeErrorSchema,
  fileTreeSequencesSchema,
  fileTreeSnapshotSchema,
  fileTreeUpdateSchema,
  nodeIdSchema,
  readBytesResultSchema,
  readFileOptionsSchema,
  readTextResultSchema,
  writeFileResultSchema,
} from './schemas';

// ---------------------------------------------------------------------------
// fs.* procedures — path-based, no handle required
// ---------------------------------------------------------------------------

const fsContract = {
  readText: oc
    .input(z.object({ path: z.string(), options: readFileOptionsSchema.optional() }))
    .output(result(readTextResultSchema, fileErrorSchema)),

  /**
   * bytes is base64 on the wire (intentional wire divergence from ReadBytesResult.bytes: Uint8Array).
   */
  readBytes: oc
    .input(z.object({ path: z.string(), options: readFileOptionsSchema.optional() }))
    .output(result(readBytesResultSchema, fileErrorSchema)),

  writeText: oc
    .input(z.object({ path: z.string(), content: z.string() }))
    .output(result(writeFileResultSchema, fileErrorSchema)),

  /**
   * bytes is base64 on the wire (intentional wire divergence from writeBytes(Uint8Array)).
   */
  writeBytes: oc
    .input(z.object({ path: z.string(), bytes: z.string() }))
    .output(result(writeFileResultSchema, fileErrorSchema)),

  stat: oc.input(z.object({ path: z.string() })).output(result(fileStatSchema, fileErrorSchema)),

  exists: oc.input(z.object({ path: z.string() })).output(result(z.boolean(), fileErrorSchema)),

  mkdir: oc
    .input(
      z.object({
        path: z.string(),
        options: z.object({ recursive: z.boolean().optional() }).optional(),
      })
    )
    .output(result(z.void(), fileErrorSchema)),

  remove: oc
    .input(
      z.object({
        path: z.string(),
        options: z.object({ recursive: z.boolean().optional() }).optional(),
      })
    )
    .output(result(z.void(), fileErrorSchema)),

  realPath: oc.input(z.object({ path: z.string() })).output(result(z.string(), fileErrorSchema)),

  copyFile: oc
    .input(z.object({ src: z.string(), dest: z.string() }))
    .output(result(z.void(), fileErrorSchema)),

  /**
   * Streams matched paths as an event iterator (models AsyncIterable<string>).
   * exclude predicate is dropped from the wire; use FileGlobOptions.cwd and dot.
   */
  glob: oc
    .input(z.object({ patterns: z.array(z.string()), options: fileGlobOptionsSchema }))
    .output(eventIterator(z.string())),

  /**
   * Streams file paths under the given directory as an event iterator.
   * The exclude predicate is dropped from the wire (not serializable).
   */
  enumerate: oc
    .input(z.object({ path: z.string(), options: fileEnumerationOptionsSchema.optional() }))
    .output(eventIterator(z.string())),
};

const runtimeContract = {
  /**
   * Opens a watched file tree at rootPath; returns a treeId handle for subsequent tree.* calls.
   */
  openTree: oc
    .input(z.object({ rootPath: z.string() }))
    .output(result(z.object({ treeId: z.string(), rootPath: z.string() }), fileTreeErrorSchema)),

  /**
   * Subscribes to file-change events for the given root.
   * The stream emits FileChangeUpdate events (initial resync + subsequent changes).
   * Aborting the request (closing the connection) unsubscribes.
   *
   * The exclude predicate is dropped from the wire — use paths allow-list instead.
   */
  watchChanges: oc
    .input(z.object({ rootPath: z.string(), options: fileChangeWatchOptionsSchema.optional() }))
    .output(eventIterator(fileChangeUpdateSchema)),
};

const treeId = z.object({ treeId: z.string() });

const treeContract = {
  release: oc.input(treeId).output(z.void()),

  ready: oc.input(treeId).output(result(z.void(), fileTreeErrorSchema)),

  getSnapshot: oc.input(treeId).output(result(fileTreeSnapshotSchema, fileTreeErrorSchema)),

  refresh: oc.input(treeId).output(result(fileTreeSnapshotSchema, fileTreeErrorSchema)),

  /**
   * Emits FileTreeUpdate events (initial snapshot + deltas).
   */
  subscribe: oc.input(treeId).output(eventIterator(fileTreeUpdateSchema)),

  registerDir: oc
    .input(treeId.extend({ dirId: nodeIdSchema.nullable() }))
    .output(result(fileTreeSequencesSchema, fileTreeErrorSchema)),

  unregisterDir: oc
    .input(treeId.extend({ dirId: nodeIdSchema.nullable() }))
    .output(result(fileTreeSequencesSchema, fileTreeErrorSchema)),

  revealPath: oc
    .input(treeId.extend({ path: z.string() }))
    .output(result(fileTreeSequencesSchema, fileTreeErrorSchema)),

  getNode: oc
    .input(treeId.extend({ id: nodeIdSchema }))
    .output(result(fileNodeSchema, fileTreeErrorSchema)),
};

export const filesContract = {
  ...runtimeContract,
  fs: fsContract,
  tree: treeContract,
};

export type FilesContract = typeof filesContract;
