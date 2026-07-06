import { eventIterator, oc } from '@orpc/contract';
import { z } from 'zod';
import { createLiveModelContract } from '../../live';
import { result } from '../shared/schemas';
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
  gitOutputResultSchema,
  gitPathInspectionSchema,
  gitRefsModelSchema,
  gitRemotesModelSchema,
  gitRepositoryInfoSchema,
  gitStashesModelSchema,
  gitVoidResultSchema,
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

const repoModel = <T extends z.ZodTypeAny>(data: T) =>
  createLiveModelContract(data, {
    snapshotInput: repoKey,
    subscribeInput: repoKey,
    unsubscribeInput: repoKey,
  });

const checkoutModel = <T extends z.ZodTypeAny>(data: T) =>
  createLiveModelContract(data, {
    snapshotInput: checkoutKey,
    subscribeInput: checkoutKey,
    unsubscribeInput: checkoutKey,
  });

const runtimeContract = {
  inspectPath: oc.input(z.object({ path: z.string() })).output(gitPathInspectionSchema),

  ensureRepository: oc
    .input(z.object({ path: z.string(), options: ensureRepositoryOptionsSchema.optional() }))
    .output(result(gitRepositoryInfoSchema, ensureRepositoryErrorSchema)),

  cloneRepository: oc
    .input(z.object({ repositoryUrl: z.string(), targetPath: z.string() }))
    .output(result(gitRepositoryInfoSchema, cloneRepositoryErrorSchema)),
};

const repositoryContract = {
  /** Branches, tags — shared across all checkouts. */
  refs: repoModel(gitRefsModelSchema),

  /** Configured remotes for this repository. */
  remotes: repoModel(gitRemotesModelSchema),

  /** Stash list — owned by the repository, not a specific checkout. */
  stashes: repoModel(gitStashesModelSchema),

  listCheckouts: oc.input(repoKey).output(z.array(checkoutInfoSchema)),

  addCheckout: oc
    .input(repoKey.extend({ options: addCheckoutOptionsSchema }))
    .output(result(checkoutInfoSchema, gitCommandErrorSchema)),

  removeCheckout: oc
    .input(repoKey.extend({ checkoutPath: z.string(), force: z.boolean().optional() }))
    .output(gitVoidResultSchema),

  pruneCheckouts: oc.input(repoKey).output(gitVoidResultSchema),

  createBranch: oc
    .input(repoKey.extend({ options: createBranchOptionsSchema }))
    .output(result(z.void(), createBranchErrorSchema)),

  deleteBranch: oc
    .input(repoKey.extend({ branch: z.string(), force: z.boolean().optional() }))
    .output(result(z.void(), deleteBranchErrorSchema)),

  renameBranch: oc
    .input(repoKey.extend({ oldName: z.string(), newName: z.string() }))
    .output(gitVoidResultSchema),

  setUpstream: oc
    .input(repoKey.extend({ branch: z.string(), upstream: z.string().nullable() }))
    .output(gitVoidResultSchema),

  createTag: oc.input(repoKey.extend({ options: tagOptionsSchema })).output(gitVoidResultSchema),

  deleteTag: oc.input(repoKey.extend({ name: z.string() })).output(gitVoidResultSchema),

  addRemote: oc
    .input(repoKey.extend({ name: z.string(), url: z.string() }))
    .output(gitVoidResultSchema),

  removeRemote: oc.input(repoKey.extend({ name: z.string() })).output(gitVoidResultSchema),

  fetch: oc
    .input(repoKey.extend({ remote: z.string().optional() }))
    .output(result(z.void(), fetchErrorSchema)),

  publishBranch: oc
    .input(repoKey.extend({ branchName: z.string(), remote: z.string().optional() }))
    .output(gitOutputResultSchema),

  getDefaultBranch: oc.input(repoKey.extend({ remote: z.string().optional() })).output(z.string()),

  fetchPrForReview: oc
    .input(repoKey.extend({ options: fetchPrForReviewOptionsSchema }))
    .output(result(z.void(), fetchPrForReviewErrorSchema)),

  readBlobAtRef: oc
    .input(repoKey.extend({ ref: z.string(), filePath: z.string() }))
    .output(z.string().nullable()),

  stashDrop: oc
    .input(repoKey.extend({ stashIndex: z.number().int().nonnegative() }))
    .output(gitVoidResultSchema),
};

const checkoutContract = {
  /** Normalized working-tree status (staged + unstaged, flat map by path). */
  status: checkoutModel(checkoutStatusModelSchema),

  /** Current HEAD position (branch / detached / unborn). */
  head: checkoutModel(gitHeadModelSchema),

  stage: oc.input(checkoutKey.extend({ paths: z.array(z.string()) })).output(gitVoidResultSchema),

  unstage: oc.input(checkoutKey.extend({ paths: z.array(z.string()) })).output(gitVoidResultSchema),

  stageAll: oc.input(checkoutKey).output(gitVoidResultSchema),

  unstageAll: oc.input(checkoutKey).output(gitVoidResultSchema),

  revert: oc.input(checkoutKey.extend({ paths: z.array(z.string()) })).output(gitVoidResultSchema),

  revertAll: oc.input(checkoutKey).output(gitVoidResultSchema),

  /** Discard all untracked and ignored files. */
  clean: oc
    .input(
      checkoutKey.extend({ paths: z.array(z.string()).optional(), force: z.boolean().optional() })
    )
    .output(gitVoidResultSchema),

  /**
   * Stage a specific hunk within a file.
   * `hunkHeader` identifies the hunk (e.g. "@@ -1,4 +1,5 @@").
   */
  stageHunk: oc
    .input(checkoutKey.extend({ path: z.string(), hunkHeader: z.string() }))
    .output(gitVoidResultSchema),

  unstageHunk: oc
    .input(checkoutKey.extend({ path: z.string(), hunkHeader: z.string() }))
    .output(gitVoidResultSchema),

  discardHunk: oc
    .input(checkoutKey.extend({ path: z.string(), hunkHeader: z.string() }))
    .output(gitVoidResultSchema),

  commit: oc
    .input(checkoutKey.extend({ message: z.string(), options: commitOptionsSchema.optional() }))
    .output(result(z.object({ hash: z.string() }), commitErrorSchema)),

  switch: oc
    .input(checkoutKey.extend({ options: switchOptionsSchema }))
    .output(result(z.void(), switchErrorSchema)),

  reset: oc
    .input(checkoutKey.extend({ ref: z.string(), mode: resetModeSchema.optional() }))
    .output(gitVoidResultSchema),

  merge: oc
    .input(checkoutKey.extend({ options: mergeOptionsSchema }))
    .output(result(z.void(), mergeErrorSchema)),

  mergeContinue: oc
    .input(checkoutKey.extend({ message: z.string().optional() }))
    .output(result(z.void(), mergeErrorSchema)),

  mergeAbort: oc.input(checkoutKey).output(gitVoidResultSchema),

  rebase: oc
    .input(checkoutKey.extend({ options: rebaseOptionsSchema }))
    .output(result(z.void(), rebaseErrorSchema)),

  rebaseContinue: oc.input(checkoutKey).output(result(z.void(), rebaseErrorSchema)),

  rebaseAbort: oc.input(checkoutKey).output(gitVoidResultSchema),

  rebaseSkip: oc.input(checkoutKey).output(gitVoidResultSchema),

  cherryPick: oc
    .input(checkoutKey.extend({ commits: z.array(z.string()), noCommit: z.boolean().optional() }))
    .output(result(z.void(), mergeErrorSchema)),

  revertCommit: oc
    .input(checkoutKey.extend({ commit: z.string(), noCommit: z.boolean().optional() }))
    .output(result(z.void(), mergeErrorSchema)),

  push: oc
    .input(checkoutKey.extend({ options: pushOptionsSchema.optional() }))
    .output(result(z.object({ output: z.string() }), pushErrorSchema)),

  pull: oc.input(checkoutKey).output(result(z.object({ output: z.string() }), pullErrorSchema)),

  sync: oc.input(checkoutKey).output(result(z.object({ output: z.string() }), pushErrorSchema)),

  stashPush: oc
    .input(checkoutKey.extend({ options: stashPushOptionsSchema.optional() }))
    .output(gitVoidResultSchema),

  stashApply: oc
    .input(checkoutKey.extend({ stashIndex: z.number().int().nonnegative().optional() }))
    .output(gitVoidResultSchema),

  stashPop: oc
    .input(checkoutKey.extend({ stashIndex: z.number().int().nonnegative().optional() }))
    .output(gitVoidResultSchema),

  getFileDiff: oc
    .input(checkoutKey.extend({ path: z.string(), base: diffTargetSchema.optional() }))
    .output(result(fileDiffSchema, gitCommandErrorSchema)),

  /**
   * Subscribes to staleness events for a file diff.
   * Emits whenever the diff would change (content, index, or ref change).
   * Callers re-fetch via getFileDiff on each event.
   */
  subscribeFileDiff: oc
    .input(checkoutKey.extend({ path: z.string(), base: diffTargetSchema.optional() }))
    .output(eventIterator(fileDiffStalenessEventSchema)),

  getChangedFiles: oc
    .input(checkoutKey.extend({ base: diffTargetSchema }))
    .output(z.array(gitChangeSchema)),

  getConflictVersions: oc
    .input(checkoutKey.extend({ path: z.string() }))
    .output(result(conflictVersionsSchema, gitCommandErrorSchema)),

  // -- Content / history reads --

  getFileAtRef: oc
    .input(checkoutKey.extend({ filePath: z.string(), ref: z.string() }))
    .output(z.string().nullable()),

  getFileAtIndex: oc
    .input(checkoutKey.extend({ filePath: z.string() }))
    .output(z.string().nullable()),

  getImageAtRef: oc
    .input(checkoutKey.extend({ filePath: z.string(), ref: z.string() }))
    .output(imageReadResultSchema),

  getImageAtIndex: oc
    .input(checkoutKey.extend({ filePath: z.string() }))
    .output(imageReadResultSchema),

  getLog: oc
    .input(checkoutKey.extend({ options: gitLogOptionsSchema.optional() }))
    .output(gitLogResultSchema),

  getCommit: oc.input(checkoutKey.extend({ hash: z.string() })).output(commitFileSchema.nullable()),

  getCommitFiles: oc
    .input(checkoutKey.extend({ hash: z.string() }))
    .output(z.array(commitFileSchema)),

  blame: oc
    .input(checkoutKey.extend({ path: z.string(), ref: z.string().optional() }))
    .output(result(blameResultSchema, gitCommandErrorSchema)),
};

// ---------------------------------------------------------------------------
// Top-level git contract (nested routers)
// ---------------------------------------------------------------------------

export const gitContract = {
  ...runtimeContract,
  repository: repositoryContract,
  checkout: checkoutContract,
};

export type GitContract = typeof gitContract;
