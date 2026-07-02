import { z } from 'zod';
import { result } from '../shared/schemas';

export const gitChangeStatusSchema = z.enum([
  'added',
  'modified',
  'deleted',
  'renamed',
  'conflicted',
]);

export const gitChangeSchema = z.object({
  path: z.string(),
  status: gitChangeStatusSchema,
  additions: z.number().int(),
  deletions: z.number().int(),
  indexOid: z.string().optional(),
});

/**
 * Per-side status code from git porcelain v2 (XY format).
 * Each file entry carries an `index` code and a `worktree` code independently.
 */
export const gitStatusCodeSchema = z.enum([
  'unmodified',
  'modified',
  'added',
  'deleted',
  'renamed',
  'copied',
  'type-changed',
  'untracked',
  'ignored',
  'unmerged',
]);

export const fileGitStatusSchema = z.object({
  path: z.string(),
  index: gitStatusCodeSchema,
  worktree: gitStatusCodeSchema,
  /** Original path, set for renames and copies. */
  origPath: z.string().optional(),
  isConflicted: z.boolean(),
});

export const checkoutOperationSchema = z.enum([
  'none',
  'merge',
  'rebase',
  'cherry-pick',
  'revert',
  'bisect',
]);

export const checkoutStatusSummarySchema = z.object({
  staged: z.number().int().nonnegative(),
  unstaged: z.number().int().nonnegative(),
  conflicted: z.number().int().nonnegative(),
  untracked: z.number().int().nonnegative(),
});

/**
 * Normalized checkout status model.
 * `entries` is a flat map keyed by path — each file appears once regardless of
 * whether it is staged, unstaged, both, or conflicted.
 */
export const checkoutStatusModelSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ok'),
    entries: z.record(z.string(), fileGitStatusSchema),
    summary: checkoutStatusSummarySchema,
    operation: checkoutOperationSchema,
  }),
  z.object({ kind: z.literal('too-many-files') }),
  z.object({ kind: z.literal('error'), message: z.string() }),
]);

export const gitHeadModelSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('branch'), name: z.string(), oid: z.string() }),
  z.object({ kind: z.literal('detached'), shortHash: z.string(), oid: z.string() }),
  z.object({ kind: z.literal('unborn'), name: z.string() }),
]);

export const gitRemoteSchema = z.object({
  name: z.string(),
  url: z.string(),
});

export const gitLocalBranchRefSchema = z.object({
  type: z.literal('local'),
  branch: z.string(),
  remote: gitRemoteSchema.optional(),
});

export const gitRemoteBranchRefSchema = z.object({
  type: z.literal('remote'),
  branch: z.string(),
  remote: gitRemoteSchema,
});

export const gitBranchRefSchema = z.union([gitLocalBranchRefSchema, gitRemoteBranchRefSchema]);

const localBranchSchema = z.object({
  type: z.literal('local'),
  branch: z.string(),
  remote: gitRemoteSchema.optional(),
  oid: z.string(),
  divergence: z.object({ ahead: z.number().int(), behind: z.number().int() }).optional(),
});

const remoteBranchSchema = z.object({
  type: z.literal('remote'),
  branch: z.string(),
  remote: gitRemoteSchema,
  oid: z.string(),
});

export const gitBranchSchema = z.union([localBranchSchema, remoteBranchSchema]);

export const gitRefsModelSchema = z.object({
  branches: z.array(gitBranchSchema),
  tags: z.array(z.object({ name: z.string(), oid: z.string(), message: z.string().optional() })),
});

export const gitRemotesModelSchema = z.object({
  remotes: z.array(gitRemoteSchema),
});

export const gitStashSchema = z.object({
  index: z.number().int().nonnegative(),
  ref: z.string(),
  message: z.string(),
  branch: z.string().optional(),
  oid: z.string(),
  createdAt: z.number().int(),
});

export const gitStashesModelSchema = z.object({
  stashes: z.array(gitStashSchema),
});

export const checkoutInfoSchema = z.object({
  checkoutPath: z.string(),
  isMain: z.boolean(),
  head: gitHeadModelSchema,
  branch: z.string().optional(),
  locked: z.boolean().optional(),
  prunable: z.boolean().optional(),
});

export const commitSchema = z.object({
  hash: z.string(),
  parents: z.array(z.string()),
  subject: z.string(),
  body: z.string(),
  author: z.string(),
  date: z.string(),
  isPushed: z.boolean(),
  tags: z.array(z.string()),
});

export const commitFileSchema = z.object({
  path: z.string(),
  status: gitChangeStatusSchema,
  additions: z.number().int(),
  deletions: z.number().int(),
});

export const gitLogResultSchema = z.object({
  commits: z.array(commitSchema),
  aheadCount: z.number().int(),
});

export const diffLineSchema = z.object({
  type: z.enum(['context', 'add', 'del', 'no-newline']),
  content: z.string(),
  oldLineNo: z.number().int().optional(),
  newLineNo: z.number().int().optional(),
});

export const diffHunkSchema = z.object({
  header: z.string(),
  oldStart: z.number().int(),
  oldLines: z.number().int(),
  newStart: z.number().int(),
  newLines: z.number().int(),
  lines: z.array(diffLineSchema),
});

export const fileDiffSchema = z.object({
  path: z.string(),
  oldOid: z.string().optional(),
  newOid: z.string().optional(),
  binary: z.boolean(),
  additions: z.number().int(),
  deletions: z.number().int(),
  hunks: z.array(diffHunkSchema),
});

/** Returned by subscribeFileDiff — signals the diff is stale and should be re-fetched. */
export const fileDiffStalenessEventSchema = z.object({
  path: z.string(),
  reason: z.enum(['content-changed', 'index-changed', 'ref-changed']),
});

export const blameHunkSchema = z.object({
  oid: z.string(),
  author: z.string(),
  authorEmail: z.string(),
  date: z.string(),
  summary: z.string(),
  startLine: z.number().int(),
  lineCount: z.number().int(),
});

export const blameResultSchema = z.object({
  hunks: z.array(blameHunkSchema),
});

export const conflictVersionsSchema = z.object({
  /** Common ancestor version. */
  base: z.string().optional(),
  /** Our (current HEAD) version. */
  ours: z.string().optional(),
  /** Theirs (incoming) version. */
  theirs: z.string().optional(),
  /** Current working-tree version (with conflict markers). */
  working: z.string().optional(),
});

export const imageBlobSchema = z.object({
  dataUrl: z.string(),
  mimeType: z.string(),
  size: z.number().int(),
});

export const imageUnavailableReasonSchema = z.enum([
  'unsupported',
  'too-large',
  'lfs-pointer',
  'git-error',
]);

export const imageReadResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('image'), image: imageBlobSchema }),
  z.object({ kind: z.literal('missing') }),
  z.object({ kind: z.literal('unavailable'), reason: imageUnavailableReasonSchema }),
]);

export const diffModeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('head') }),
  z.object({ kind: z.literal('staged') }),
]);

export const gitObjectRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('branch'), branch: gitBranchRefSchema }),
  z.object({ kind: z.literal('commit'), sha: z.string() }),
  z.object({ kind: z.literal('tag'), name: z.string() }),
]);

export const mergeBaseRangeSchema = z.object({
  base: gitObjectRefSchema,
  head: gitObjectRefSchema,
});

export const diffTargetSchema = z.union([diffModeSchema, gitObjectRefSchema, mergeBaseRangeSchema]);

export const gitRepositoryInfoSchema = z.object({
  kind: z.literal('repository'),
  rootPath: z.string(),
  baseRef: z.string(),
});

export const gitPathInspectionSchema = z.union([
  gitRepositoryInfoSchema,
  z.object({ kind: z.literal('not-repository'), path: z.string() }),
  z.object({ kind: z.literal('inspect-failed'), path: z.string(), message: z.string() }),
]);

export const gitCommandErrorSchema = z.object({
  type: z.literal('git_error'),
  message: z.string(),
  stderr: z.string().optional(),
});

export const cloneRepositoryErrorSchema = z.union([
  z.object({ type: z.literal('target_exists'), path: z.string(), message: z.string() }),
  z.object({ type: z.literal('auth_failed'), message: z.string() }),
  z.object({ type: z.literal('remote_not_found'), message: z.string() }),
  gitCommandErrorSchema,
]);

export const ensureRepositoryErrorSchema = z.union([
  z.object({ type: z.literal('not-repository'), path: z.string() }),
  z.object({ type: z.literal('inspect-failed'), path: z.string(), message: z.string() }),
  z.object({ type: z.literal('init-failed'), path: z.string(), message: z.string() }),
]);

export const fetchErrorSchema = z.union([
  z.object({ type: z.literal('no_remote'), message: z.string().optional() }),
  z.object({
    type: z.literal('remote_not_found'),
    remote: z.string().optional(),
    message: z.string(),
  }),
  z.object({ type: z.literal('auth_failed'), message: z.string() }),
  z.object({ type: z.literal('network_error'), message: z.string() }),
  gitCommandErrorSchema,
]);

export const commitErrorSchema = z.union([
  z.object({ type: z.literal('nothing_to_commit'), message: z.string() }),
  z.object({ type: z.literal('empty_message'), message: z.string() }),
  z.object({ type: z.literal('hook_failed'), message: z.string() }),
  gitCommandErrorSchema,
]);

export const pushErrorSchema = z.union([
  z.object({ type: z.literal('no_remote'), message: z.string().optional() }),
  z.object({ type: z.literal('no_upstream'), message: z.string() }),
  z.object({ type: z.literal('rejected'), message: z.string() }),
  z.object({ type: z.literal('auth_failed'), message: z.string() }),
  z.object({ type: z.literal('network_error'), message: z.string() }),
  z.object({ type: z.literal('hook_rejected'), message: z.string() }),
  gitCommandErrorSchema,
]);

export const pullErrorSchema = z.union([
  z.object({
    type: z.literal('conflict'),
    message: z.string(),
    conflictedFiles: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal('no_upstream'), message: z.string() }),
  z.object({ type: z.literal('diverged'), message: z.string() }),
  z.object({ type: z.literal('auth_failed'), message: z.string() }),
  z.object({ type: z.literal('network_error'), message: z.string() }),
  gitCommandErrorSchema,
]);

// CreateBranchError nests FetchError recursively
export const createBranchErrorSchema = z.union([
  z.object({ type: z.literal('already_exists'), branch: z.string(), message: z.string() }),
  z.object({ type: z.literal('invalid_name'), branch: z.string(), message: z.string() }),
  z.object({
    type: z.literal('invalid_base'),
    branch: z.string(),
    from: z.string(),
    message: z.string(),
  }),
  z.object({
    type: z.literal('fetch_failed'),
    remote: z.string(),
    branch: z.string(),
    error: fetchErrorSchema,
  }),
  gitCommandErrorSchema,
]);

export const fetchPrForReviewErrorSchema = z.union([
  z.object({ type: z.literal('not_found'), prNumber: z.number().int(), message: z.string() }),
  gitCommandErrorSchema,
]);

export const deleteBranchErrorSchema = z.union([
  z.object({ type: z.literal('not_found'), branch: z.string(), message: z.string() }),
  z.object({ type: z.literal('not_merged'), branch: z.string(), message: z.string() }),
  z.object({ type: z.literal('is_current'), branch: z.string(), message: z.string() }),
  gitCommandErrorSchema,
]);

export const mergeErrorSchema = z.union([
  z.object({
    type: z.literal('conflict'),
    message: z.string(),
    conflictedFiles: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal('already_up_to_date'), message: z.string() }),
  gitCommandErrorSchema,
]);

export const rebaseErrorSchema = z.union([
  z.object({
    type: z.literal('conflict'),
    message: z.string(),
    conflictedFiles: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal('nothing_to_rebase'), message: z.string() }),
  gitCommandErrorSchema,
]);

export const switchErrorSchema = z.union([
  z.object({ type: z.literal('local_changes'), message: z.string() }),
  z.object({ type: z.literal('not_found'), ref: z.string(), message: z.string() }),
  gitCommandErrorSchema,
]);

export const ensureRepositoryOptionsSchema = z.object({
  initIfMissing: z.boolean().optional(),
});

export const createBranchOptionsSchema = z.object({
  name: z.string(),
  from: z.string().optional(),
  syncWithRemote: z.boolean().optional(),
  remote: z.string().optional(),
});

export const fetchPrForReviewOptionsSchema = z.object({
  prNumber: z.number().int(),
  headRefName: z.string(),
  headRepositoryUrl: z.string(),
  localBranch: z.string(),
  isFork: z.boolean(),
  configuredRemote: z.string().optional(),
});

// GitLogOptions.base/head are restricted to GitObjectRef (branch|commit|tag only)
export const gitLogOptionsSchema = z.object({
  maxCount: z.number().int().optional(),
  limit: z.number().int().optional(),
  skip: z.number().int().optional(),
  knownAheadCount: z.number().int().optional(),
  preferredRemote: z.string().optional(),
  base: gitObjectRefSchema.optional(),
  head: gitObjectRefSchema.optional(),
});

export const commitOptionsSchema = z.object({
  amend: z.boolean().optional(),
  signoff: z.boolean().optional(),
  noVerify: z.boolean().optional(),
  allowEmpty: z.boolean().optional(),
});

export const resetModeSchema = z.enum(['soft', 'mixed', 'hard']);

export const switchOptionsSchema = z.object({
  /** Ref to switch to (branch name, tag, or commit SHA). */
  ref: z.string(),
  /** Create a new branch at this ref. */
  newBranch: z.string().optional(),
  /** Force switch even when local changes exist (discard). */
  force: z.boolean().optional(),
});

export const mergeOptionsSchema = z.object({
  branch: z.string(),
  /** Prevent fast-forward; always create a merge commit. */
  noFf: z.boolean().optional(),
  squash: z.boolean().optional(),
  message: z.string().optional(),
});

export const rebaseOptionsSchema = z.object({
  /** Branch / ref to rebase onto. */
  onto: z.string(),
  /** Interactive (implies passing --interactive to git, not modelled further here). */
  interactive: z.boolean().optional(),
});

export const pushOptionsSchema = z.object({
  remote: z.string().optional(),
  force: z.boolean().optional(),
  setUpstream: z.boolean().optional(),
});

export const stashPushOptionsSchema = z.object({
  message: z.string().optional(),
  includeUntracked: z.boolean().optional(),
  keepIndex: z.boolean().optional(),
  paths: z.array(z.string()).optional(),
});

export const addCheckoutOptionsSchema = z.object({
  /** Destination path for the new worktree. */
  path: z.string(),
  /** Branch to check out; creates it if combined with `newBranch`. */
  ref: z.string().optional(),
  /** Name for a new branch created at this worktree. */
  newBranch: z.string().optional(),
  force: z.boolean().optional(),
});

export const tagOptionsSchema = z.object({
  name: z.string(),
  ref: z.string().optional(),
  message: z.string().optional(),
  force: z.boolean().optional(),
});

/** result(void, gitCommandError) — for mutations with no payload on success. */
export const gitVoidResultSchema = result(z.void(), gitCommandErrorSchema);

/** result({ output }, pushError) — for push/publishBranch where stdout matters. */
export const gitOutputResultSchema = result(z.object({ output: z.string() }), pushErrorSchema);
