import { defineContract, fallible, liveModel, liveState, procedure } from '@emdash/wire';
import { z } from 'zod';
import {
  addCheckoutOptionsSchema,
  blameResultSchema,
  checkoutInfoSchema,
  checkoutStatusModelSchema,
  cloneRepositoryErrorSchema,
  commitErrorSchema,
  commitFileSchema,
  conflictVersionsSchema,
  createBranchErrorSchema,
  createBranchOptionsSchema,
  deleteBranchErrorSchema,
  diffTargetSchema,
  ensureRepositoryErrorSchema,
  ensureRepositoryOptionsSchema,
  fetchErrorSchema,
  fetchPrForReviewErrorSchema,
  fetchPrForReviewOptionsSchema,
  fileDiffSchema,
  fileDiffStalenessEventSchema,
  gitChangeSchema,
  gitCommandErrorSchema,
  gitHeadModelSchema,
  gitLogOptionsSchema,
  gitLogResultSchema,
  gitPathInspectionSchema,
  gitRefsModelSchema,
  gitRemotesModelSchema,
  gitRepositoryInfoSchema,
  gitStashesModelSchema,
  imageReadResultSchema,
  mergeErrorSchema,
  mergeOptionsSchema,
  pushErrorSchema,
  pushOptionsSchema,
  pullErrorSchema,
  rebaseErrorSchema,
  rebaseOptionsSchema,
  resetModeSchema,
  stashPushOptionsSchema,
  switchErrorSchema,
  switchOptionsSchema,
  tagOptionsSchema,
  commitOptionsSchema,
} from './schemas';

const repoKey = z.object({ repositoryRoot: z.string() });
const checkoutKey = z.object({ checkoutPath: z.string() });
const fileDiffKey = checkoutKey.extend({ path: z.string(), base: diffTargetSchema.optional() });

const fileDiffStalenessModelSchema = z.object({
  revision: z.number().int(),
  lastEvent: fileDiffStalenessEventSchema.nullable(),
});

const runtimeContract = {
  inspectPath: procedure({
    input: z.object({ path: z.string() }),
    output: gitPathInspectionSchema,
  }),

  ensureRepository: fallible({
    input: z.object({ path: z.string(), options: ensureRepositoryOptionsSchema.optional() }),
    data: gitRepositoryInfoSchema,
    error: ensureRepositoryErrorSchema,
  }),

  cloneRepository: fallible({
    input: z.object({ repositoryUrl: z.string(), targetPath: z.string() }),
    data: gitRepositoryInfoSchema,
    error: cloneRepositoryErrorSchema,
  }),
};

const repositoryContract = defineContract({
  model: liveModel({
    key: repoKey,
    states: {
      /** Branches, tags — shared across all checkouts. */
      refs: liveState({ data: gitRefsModelSchema }),
      /** Configured remotes for this repository. */
      remotes: liveState({ data: gitRemotesModelSchema }),
      /** Stash list — owned by the repository, not a specific checkout. */
      stashes: liveState({ data: gitStashesModelSchema }),
    },
  }),

  listCheckouts: procedure({ input: repoKey, output: z.array(checkoutInfoSchema) }),

  addCheckout: fallible({
    input: repoKey.extend({ options: addCheckoutOptionsSchema }),
    data: checkoutInfoSchema,
    error: gitCommandErrorSchema,
  }),

  removeCheckout: fallible({
    input: repoKey.extend({ checkoutPath: z.string(), force: z.boolean().optional() }),
    data: z.void(),
    error: gitCommandErrorSchema,
  }),

  pruneCheckouts: fallible({ input: repoKey, data: z.void(), error: gitCommandErrorSchema }),

  createBranch: fallible({
    input: repoKey.extend({ options: createBranchOptionsSchema }),
    data: z.void(),
    error: createBranchErrorSchema,
  }),

  deleteBranch: fallible({
    input: repoKey.extend({ branch: z.string(), force: z.boolean().optional() }),
    data: z.void(),
    error: deleteBranchErrorSchema,
  }),

  renameBranch: fallible({
    input: repoKey.extend({ oldName: z.string(), newName: z.string() }),
    data: z.void(),
    error: gitCommandErrorSchema,
  }),

  setUpstream: fallible({
    input: repoKey.extend({ branch: z.string(), upstream: z.string().nullable() }),
    data: z.void(),
    error: gitCommandErrorSchema,
  }),

  createTag: fallible({
    input: repoKey.extend({ options: tagOptionsSchema }),
    data: z.void(),
    error: gitCommandErrorSchema,
  }),

  deleteTag: fallible({
    input: repoKey.extend({ name: z.string() }),
    data: z.void(),
    error: gitCommandErrorSchema,
  }),

  addRemote: fallible({
    input: repoKey.extend({ name: z.string(), url: z.string() }),
    data: z.void(),
    error: gitCommandErrorSchema,
  }),

  removeRemote: fallible({
    input: repoKey.extend({ name: z.string() }),
    data: z.void(),
    error: gitCommandErrorSchema,
  }),

  fetch: fallible({
    input: repoKey.extend({ remote: z.string().optional() }),
    data: z.void(),
    error: fetchErrorSchema,
  }),

  publishBranch: fallible({
    input: repoKey.extend({ branchName: z.string(), remote: z.string().optional() }),
    data: z.object({ output: z.string() }),
    error: pushErrorSchema,
  }),

  getDefaultBranch: procedure({
    input: repoKey.extend({ remote: z.string().optional() }),
    output: z.string(),
  }),

  fetchPrForReview: fallible({
    input: repoKey.extend({ options: fetchPrForReviewOptionsSchema }),
    data: z.void(),
    error: fetchPrForReviewErrorSchema,
  }),

  readBlobAtRef: procedure({
    input: repoKey.extend({ ref: z.string(), filePath: z.string() }),
    output: z.string().nullable(),
  }),

  stashDrop: fallible({
    input: repoKey.extend({ stashIndex: z.number().int().nonnegative() }),
    data: z.void(),
    error: gitCommandErrorSchema,
  }),
});

const checkoutContract = defineContract({
  model: liveModel({
    key: checkoutKey,
    states: {
      /** Normalized working-tree status (staged + unstaged, flat map by path). */
      status: liveState({ data: checkoutStatusModelSchema }),
      /** Current HEAD position (branch / detached / unborn). */
      head: liveState({ data: gitHeadModelSchema }),
    },
  }),

  stage: fallible({
    input: checkoutKey.extend({ paths: z.array(z.string()) }),
    data: z.void(),
    error: gitCommandErrorSchema,
  }),

  unstage: fallible({
    input: checkoutKey.extend({ paths: z.array(z.string()) }),
    data: z.void(),
    error: gitCommandErrorSchema,
  }),

  stageAll: fallible({ input: checkoutKey, data: z.void(), error: gitCommandErrorSchema }),

  unstageAll: fallible({ input: checkoutKey, data: z.void(), error: gitCommandErrorSchema }),

  revert: fallible({
    input: checkoutKey.extend({ paths: z.array(z.string()) }),
    data: z.void(),
    error: gitCommandErrorSchema,
  }),

  revertAll: fallible({ input: checkoutKey, data: z.void(), error: gitCommandErrorSchema }),

  /** Discard all untracked and ignored files. */
  clean: fallible({
    input: checkoutKey.extend({
      paths: z.array(z.string()).optional(),
      force: z.boolean().optional(),
    }),
    data: z.void(),
    error: gitCommandErrorSchema,
  }),

  /**
   * Stage a specific hunk within a file.
   * `hunkHeader` identifies the hunk (e.g. "@@ -1,4 +1,5 @@").
   */
  stageHunk: fallible({
    input: checkoutKey.extend({ path: z.string(), hunkHeader: z.string() }),
    data: z.void(),
    error: gitCommandErrorSchema,
  }),

  unstageHunk: fallible({
    input: checkoutKey.extend({ path: z.string(), hunkHeader: z.string() }),
    data: z.void(),
    error: gitCommandErrorSchema,
  }),

  discardHunk: fallible({
    input: checkoutKey.extend({ path: z.string(), hunkHeader: z.string() }),
    data: z.void(),
    error: gitCommandErrorSchema,
  }),

  commit: fallible({
    input: checkoutKey.extend({ message: z.string(), options: commitOptionsSchema.optional() }),
    data: z.object({ hash: z.string() }),
    error: commitErrorSchema,
  }),

  switch: fallible({
    input: checkoutKey.extend({ options: switchOptionsSchema }),
    data: z.void(),
    error: switchErrorSchema,
  }),

  reset: fallible({
    input: checkoutKey.extend({ ref: z.string(), mode: resetModeSchema.optional() }),
    data: z.void(),
    error: gitCommandErrorSchema,
  }),

  merge: fallible({
    input: checkoutKey.extend({ options: mergeOptionsSchema }),
    data: z.void(),
    error: mergeErrorSchema,
  }),

  mergeContinue: fallible({
    input: checkoutKey.extend({ message: z.string().optional() }),
    data: z.void(),
    error: mergeErrorSchema,
  }),

  mergeAbort: fallible({ input: checkoutKey, data: z.void(), error: gitCommandErrorSchema }),

  rebase: fallible({
    input: checkoutKey.extend({ options: rebaseOptionsSchema }),
    data: z.void(),
    error: rebaseErrorSchema,
  }),

  rebaseContinue: fallible({ input: checkoutKey, data: z.void(), error: rebaseErrorSchema }),

  rebaseAbort: fallible({ input: checkoutKey, data: z.void(), error: gitCommandErrorSchema }),

  rebaseSkip: fallible({ input: checkoutKey, data: z.void(), error: gitCommandErrorSchema }),

  cherryPick: fallible({
    input: checkoutKey.extend({ commits: z.array(z.string()), noCommit: z.boolean().optional() }),
    data: z.void(),
    error: mergeErrorSchema,
  }),

  revertCommit: fallible({
    input: checkoutKey.extend({ commit: z.string(), noCommit: z.boolean().optional() }),
    data: z.void(),
    error: mergeErrorSchema,
  }),

  push: fallible({
    input: checkoutKey.extend({ options: pushOptionsSchema.optional() }),
    data: z.object({ output: z.string() }),
    error: pushErrorSchema,
  }),

  pull: fallible({
    input: checkoutKey,
    data: z.object({ output: z.string() }),
    error: pullErrorSchema,
  }),

  sync: fallible({
    input: checkoutKey,
    data: z.object({ output: z.string() }),
    error: pushErrorSchema,
  }),

  stashPush: fallible({
    input: checkoutKey.extend({ options: stashPushOptionsSchema.optional() }),
    data: z.void(),
    error: gitCommandErrorSchema,
  }),

  stashApply: fallible({
    input: checkoutKey.extend({ stashIndex: z.number().int().nonnegative().optional() }),
    data: z.void(),
    error: gitCommandErrorSchema,
  }),

  stashPop: fallible({
    input: checkoutKey.extend({ stashIndex: z.number().int().nonnegative().optional() }),
    data: z.void(),
    error: gitCommandErrorSchema,
  }),

  getFileDiff: fallible({
    input: fileDiffKey,
    data: fileDiffSchema,
    error: gitCommandErrorSchema,
  }),

  /**
   * Reactive staleness state for a file diff. Callers re-fetch via getFileDiff
   * whenever revision changes.
   */
  fileDiff: liveModel({
    key: fileDiffKey,
    states: {
      staleness: liveState({ data: fileDiffStalenessModelSchema }),
    },
  }),

  getChangedFiles: procedure({
    input: checkoutKey.extend({ base: diffTargetSchema }),
    output: z.array(gitChangeSchema),
  }),

  getConflictVersions: fallible({
    input: checkoutKey.extend({ path: z.string() }),
    data: conflictVersionsSchema,
    error: gitCommandErrorSchema,
  }),

  // -- Content / history reads --

  getFileAtRef: procedure({
    input: checkoutKey.extend({ filePath: z.string(), ref: z.string() }),
    output: z.string().nullable(),
  }),

  getFileAtIndex: procedure({
    input: checkoutKey.extend({ filePath: z.string() }),
    output: z.string().nullable(),
  }),

  getImageAtRef: procedure({
    input: checkoutKey.extend({ filePath: z.string(), ref: z.string() }),
    output: imageReadResultSchema,
  }),

  getImageAtIndex: procedure({
    input: checkoutKey.extend({ filePath: z.string() }),
    output: imageReadResultSchema,
  }),

  getLog: procedure({
    input: checkoutKey.extend({ options: gitLogOptionsSchema.optional() }),
    output: gitLogResultSchema,
  }),

  getCommit: procedure({
    input: checkoutKey.extend({ hash: z.string() }),
    output: commitFileSchema.nullable(),
  }),

  getCommitFiles: procedure({
    input: checkoutKey.extend({ hash: z.string() }),
    output: z.array(commitFileSchema),
  }),

  blame: fallible({
    input: checkoutKey.extend({ path: z.string(), ref: z.string().optional() }),
    data: blameResultSchema,
    error: gitCommandErrorSchema,
  }),
});

// ---------------------------------------------------------------------------
// Top-level git contract (nested routers)
// ---------------------------------------------------------------------------

export const gitContract = defineContract({
  ...runtimeContract,
  repository: repositoryContract,
  checkout: checkoutContract,
});

export type GitContract = typeof gitContract;
