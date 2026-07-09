import {
  defineContract,
  fallible,
  liveJob,
  liveModel,
  liveState,
  mutation,
  procedure,
} from '@emdash/wire';
import { z } from 'zod';
import {
  commitErrorSchema,
  gitCommandErrorSchema,
  mergeErrorSchema,
  pullErrorSchema,
  pushErrorSchema,
  rebaseErrorSchema,
  switchErrorSchema,
  syncErrorSchema,
} from '../api/errors';
import { syncProgressSchema, transferProgressSchema } from '../api/schemas';
import { checkoutKeySchema } from './key';
import { fileDiffStalenessSchema } from './models/file-diff';
import { gitHeadModelSchema } from './models/head';
import { checkoutStatusModelSchema } from './models/status';
import {
  blameResultSchema,
  commitFileSchema,
  commitOptionsSchema,
  commitSchema,
  conflictVersionsSchema,
  diffTargetSchema,
  fileDiffSchema,
  gitChangeSchema,
  gitLogOptionsSchema,
  gitLogResultSchema,
  imageReadResultSchema,
  mergeOptionsSchema,
  pullJobInputSchema,
  pushJobInputSchema,
  rebaseOptionsSchema,
  resetModeSchema,
  stashPushOptionsSchema,
  switchOptionsSchema,
  syncJobInputSchema,
} from './schemas';

export const gitCheckoutContract = defineContract({
  model: liveModel({
    key: checkoutKeySchema,
    states: {
      status: liveState({ data: checkoutStatusModelSchema }),
      head: liveState({ data: gitHeadModelSchema }),
    },
    mutations: {
      stage: mutation({
        input: z.object({ paths: z.array(z.string()) }),
        data: z.void(),
        error: gitCommandErrorSchema,
      }),
      unstage: mutation({
        input: z.object({ paths: z.array(z.string()) }),
        data: z.void(),
        error: gitCommandErrorSchema,
      }),
      stageAll: mutation({ input: z.object({}), data: z.void(), error: gitCommandErrorSchema }),
      unstageAll: mutation({ input: z.object({}), data: z.void(), error: gitCommandErrorSchema }),
      revert: mutation({
        input: z.object({ paths: z.array(z.string()) }),
        data: z.void(),
        error: gitCommandErrorSchema,
      }),
      revertAll: mutation({ input: z.object({}), data: z.void(), error: gitCommandErrorSchema }),
      clean: mutation({
        input: z.object({ paths: z.array(z.string()).optional(), force: z.boolean().optional() }),
        data: z.void(),
        error: gitCommandErrorSchema,
      }),
      stageHunk: mutation({
        input: z.object({ path: z.string(), hunkHeader: z.string() }),
        data: z.void(),
        error: gitCommandErrorSchema,
      }),
      unstageHunk: mutation({
        input: z.object({ path: z.string(), hunkHeader: z.string() }),
        data: z.void(),
        error: gitCommandErrorSchema,
      }),
      discardHunk: mutation({
        input: z.object({ path: z.string(), hunkHeader: z.string() }),
        data: z.void(),
        error: gitCommandErrorSchema,
      }),
      commit: mutation({
        input: z.object({ message: z.string(), options: commitOptionsSchema.optional() }),
        data: z.object({ hash: z.string() }),
        error: commitErrorSchema,
      }),
      switch: mutation({
        input: z.object({ options: switchOptionsSchema }),
        data: z.void(),
        error: switchErrorSchema,
      }),
      reset: mutation({
        input: z.object({ ref: z.string(), mode: resetModeSchema.optional() }),
        data: z.void(),
        error: gitCommandErrorSchema,
      }),
      merge: mutation({
        input: z.object({ options: mergeOptionsSchema }),
        data: z.void(),
        error: mergeErrorSchema,
      }),
      mergeContinue: mutation({
        input: z.object({ message: z.string().optional() }),
        data: z.void(),
        error: mergeErrorSchema,
      }),
      mergeAbort: mutation({ input: z.object({}), data: z.void(), error: gitCommandErrorSchema }),
      rebase: mutation({
        input: z.object({ options: rebaseOptionsSchema }),
        data: z.void(),
        error: rebaseErrorSchema,
      }),
      rebaseContinue: mutation({ input: z.object({}), data: z.void(), error: rebaseErrorSchema }),
      rebaseAbort: mutation({ input: z.object({}), data: z.void(), error: gitCommandErrorSchema }),
      rebaseSkip: mutation({ input: z.object({}), data: z.void(), error: gitCommandErrorSchema }),
      cherryPick: mutation({
        input: z.object({ commits: z.array(z.string()), noCommit: z.boolean().optional() }),
        data: z.void(),
        error: mergeErrorSchema,
      }),
      revertCommit: mutation({
        input: z.object({ commit: z.string(), noCommit: z.boolean().optional() }),
        data: z.void(),
        error: mergeErrorSchema,
      }),
      stashPush: mutation({
        input: z.object({ options: stashPushOptionsSchema.optional() }),
        data: z.void(),
        error: gitCommandErrorSchema,
      }),
      stashApply: mutation({
        input: z.object({ stashIndex: z.number().int().nonnegative().optional() }),
        data: z.void(),
        error: gitCommandErrorSchema,
      }),
      stashPop: mutation({
        input: z.object({ stashIndex: z.number().int().nonnegative().optional() }),
        data: z.void(),
        error: gitCommandErrorSchema,
      }),
    },
  }),

  fileDiff: liveModel({
    key: checkoutKeySchema.extend({ path: z.string() }),
    states: {
      staleness: liveState({ data: fileDiffStalenessSchema }),
    },
  }),

  open: fallible({
    input: z.object({ path: z.string() }),
    data: checkoutKeySchema,
    error: gitCommandErrorSchema,
  }),
  close: procedure({ input: checkoutKeySchema, output: z.void() }),

  getFileDiff: fallible({
    input: checkoutKeySchema.extend({ path: z.string(), base: diffTargetSchema.optional() }),
    data: fileDiffSchema,
    error: gitCommandErrorSchema,
  }),
  getChangedFiles: fallible({
    input: checkoutKeySchema.extend({ base: diffTargetSchema }),
    data: z.array(gitChangeSchema),
    error: gitCommandErrorSchema,
  }),
  getConflictVersions: fallible({
    input: checkoutKeySchema.extend({ path: z.string() }),
    data: conflictVersionsSchema,
    error: gitCommandErrorSchema,
  }),
  getFileAtRef: fallible({
    input: checkoutKeySchema.extend({ filePath: z.string(), ref: z.string() }),
    data: z.string().nullable(),
    error: gitCommandErrorSchema,
  }),
  getFileAtIndex: fallible({
    input: checkoutKeySchema.extend({ filePath: z.string() }),
    data: z.string().nullable(),
    error: gitCommandErrorSchema,
  }),
  getImageAtRef: fallible({
    input: checkoutKeySchema.extend({ filePath: z.string(), ref: z.string() }),
    data: imageReadResultSchema,
    error: gitCommandErrorSchema,
  }),
  getImageAtIndex: fallible({
    input: checkoutKeySchema.extend({ filePath: z.string() }),
    data: imageReadResultSchema,
    error: gitCommandErrorSchema,
  }),
  getLog: fallible({
    input: checkoutKeySchema.extend({ options: gitLogOptionsSchema.optional() }),
    data: gitLogResultSchema,
    error: gitCommandErrorSchema,
  }),
  getCommit: fallible({
    input: checkoutKeySchema.extend({ hash: z.string() }),
    data: commitSchema.nullable(),
    error: gitCommandErrorSchema,
  }),
  getCommitFiles: fallible({
    input: checkoutKeySchema.extend({ hash: z.string() }),
    data: z.array(commitFileSchema),
    error: gitCommandErrorSchema,
  }),
  blame: fallible({
    input: checkoutKeySchema.extend({ path: z.string(), ref: z.string().optional() }),
    data: blameResultSchema,
    error: gitCommandErrorSchema,
  }),

  push: liveJob({
    input: pushJobInputSchema,
    progress: transferProgressSchema,
    result: z.object({ output: z.string() }),
    error: pushErrorSchema,
  }),
  pull: liveJob({
    input: pullJobInputSchema,
    progress: transferProgressSchema,
    result: z.object({ output: z.string() }),
    error: pullErrorSchema,
  }),
  sync: liveJob({
    input: syncJobInputSchema,
    progress: syncProgressSchema,
    result: z.object({ output: z.string() }),
    error: syncErrorSchema,
  }),
});

export type GitCheckoutContract = typeof gitCheckoutContract;
