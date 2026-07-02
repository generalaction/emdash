import { z } from 'zod';
import { liveValue, result } from '../shared/schemas';

// ---------------------------------------------------------------------------
// Status models
// ---------------------------------------------------------------------------

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

export const gitStatusModelSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ok'),
    staged: z.array(gitChangeSchema),
    unstaged: z.array(gitChangeSchema),
    stagedAdded: z.number().int(),
    stagedDeleted: z.number().int(),
  }),
  z.object({ kind: z.literal('too-many-files') }),
  z.object({ kind: z.literal('error'), message: z.string() }),
]);

export const gitStatusUntrackedModeSchema = z.enum(['no', 'normal']);

export const gitStatusFingerprintSchema = z.object({
  hash: z.string(),
  byteLength: z.number().int(),
});

// ---------------------------------------------------------------------------
// Head model
// ---------------------------------------------------------------------------

export const gitHeadModelSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('branch'), name: z.string(), oid: z.string() }),
  z.object({ kind: z.literal('detached'), shortHash: z.string(), oid: z.string() }),
  z.object({ kind: z.literal('unborn'), name: z.string() }),
]);

// ---------------------------------------------------------------------------
// Refs / remotes models
// ---------------------------------------------------------------------------

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
});

export const gitRemotesModelSchema = z.object({
  remotes: z.array(gitRemoteSchema),
});

// ---------------------------------------------------------------------------
// Log models
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Image read result
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Diff target
//
// MergeBaseRange has no 'kind' field so this cannot be a discriminatedUnion;
// z.union is used instead. This is an intentional wire divergence from the TS
// type which relies on structural typing. Callers should treat DiffTarget as
// a plain union on the wire.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Path inspection
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Sequences
// ---------------------------------------------------------------------------

export const gitModelKindSchema = z.enum(['status', 'head', 'refs', 'remotes']);

export const gitSequencesSchema = z.object({
  status: z.number().int().optional(),
  head: z.number().int().optional(),
  refs: z.number().int().optional(),
  remotes: z.number().int().optional(),
});

// ---------------------------------------------------------------------------
// Model updates (carry generation + sequence for read-your-writes)
// ---------------------------------------------------------------------------

export const gitWorktreeUpdateSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('status'),
    generation: z.number().int(),
    sequence: z.number().int(),
    model: gitStatusModelSchema,
  }),
  z.object({
    kind: z.literal('head'),
    generation: z.number().int(),
    sequence: z.number().int(),
    model: gitHeadModelSchema,
  }),
]);

export const gitRepoUpdateSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('refs'),
    generation: z.number().int(),
    sequence: z.number().int(),
    model: gitRefsModelSchema,
  }),
  z.object({
    kind: z.literal('remotes'),
    generation: z.number().int(),
    sequence: z.number().int(),
    model: gitRemotesModelSchema,
  }),
]);

// Snapshots (LiveValue wrappers for read-model state)
export const gitWorktreeSnapshotSchema = z.object({
  status: liveValue(gitStatusModelSchema),
  head: liveValue(gitHeadModelSchema),
});

export const gitRepoSnapshotSchema = z.object({
  refs: liveValue(gitRefsModelSchema),
  remotes: liveValue(gitRemotesModelSchema),
});

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Option / param types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Convenience result helpers used by the contract
// ---------------------------------------------------------------------------

export const gitSequencesResultSchema = result(
  z.object({ sequences: gitSequencesSchema }),
  gitCommandErrorSchema
);

export const gitOutputSequencesResultSchema = result(
  z.object({ output: z.string(), sequences: gitSequencesSchema }),
  pushErrorSchema
);
