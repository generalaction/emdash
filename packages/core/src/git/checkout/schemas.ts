import { z } from 'zod';
import { gitBranchRefSchema } from '../repository/models/refs';
import { checkoutKeySchema } from './key';

/**
 * Checkout subdomain schemas: the read/diff/history vocabulary and the option
 * shapes for checkout mutations and jobs. Object refs reference the repository's
 * branch model (a checkout resolves refs against its repository).
 */

export const gitChangeStatusSchema = z.enum([
  'added',
  'modified',
  'deleted',
  'renamed',
  'conflicted',
]);
export type GitChangeStatus = z.infer<typeof gitChangeStatusSchema>;

/**
 * Path convention: all paths returned by the git domain are absolute.
 * Path inputs accept absolute paths (checkout-relative paths are tolerated
 * and normalized internally before reaching git).
 */
export const fileChangeSchema = z.object({
  path: z.string(),
  status: gitChangeStatusSchema,
  additions: z.number().int(),
  deletions: z.number().int(),
  indexOid: z.string().optional(),
});
export type FileChange = z.infer<typeof fileChangeSchema>;

export const gitChangeSchema = fileChangeSchema;
export type GitChange = z.infer<typeof gitChangeSchema>;

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
export type Commit = z.infer<typeof commitSchema>;

export const commitFileSchema = fileChangeSchema;
export type CommitFile = z.infer<typeof commitFileSchema>;

export const gitLogResultSchema = z.object({
  commits: z.array(commitSchema),
});
export type GitLogResult = z.infer<typeof gitLogResultSchema>;

export const diffLineSchema = z.object({
  type: z.enum(['context', 'add', 'del', 'no-newline']),
  content: z.string(),
  oldLineNo: z.number().int().optional(),
  newLineNo: z.number().int().optional(),
});
export type DiffLine = z.infer<typeof diffLineSchema>;

export const diffHunkSchema = z.object({
  header: z.string(),
  oldStart: z.number().int(),
  oldLines: z.number().int(),
  newStart: z.number().int(),
  newLines: z.number().int(),
  lines: z.array(diffLineSchema),
});
export type DiffHunk = z.infer<typeof diffHunkSchema>;

export const fileDiffSchema = z.object({
  path: z.string(),
  oldOid: z.string().optional(),
  newOid: z.string().optional(),
  binary: z.boolean(),
  additions: z.number().int(),
  deletions: z.number().int(),
  hunks: z.array(diffHunkSchema),
});
export type FileDiff = z.infer<typeof fileDiffSchema>;

export const blameHunkSchema = z.object({
  oid: z.string(),
  author: z.string(),
  authorEmail: z.string(),
  date: z.string(),
  summary: z.string(),
  startLine: z.number().int(),
  lineCount: z.number().int(),
});
export type BlameHunk = z.infer<typeof blameHunkSchema>;

export const blameResultSchema = z.object({
  hunks: z.array(blameHunkSchema),
});
export type BlameResult = z.infer<typeof blameResultSchema>;

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
export type ConflictVersions = z.infer<typeof conflictVersionsSchema>;

export const imageBlobSchema = z.object({
  dataUrl: z.string(),
  mimeType: z.string(),
  size: z.number().int(),
});
export type ImageBlob = z.infer<typeof imageBlobSchema>;

export const imageUnavailableReasonSchema = z.enum([
  'unsupported',
  'too-large',
  'lfs-pointer',
  'git-error',
]);
export type ImageUnavailableReason = z.infer<typeof imageUnavailableReasonSchema>;

export const imageReadResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('image'), image: imageBlobSchema }),
  z.object({ kind: z.literal('missing') }),
  z.object({ kind: z.literal('unavailable'), reason: imageUnavailableReasonSchema }),
]);
export type ImageReadResult = z.infer<typeof imageReadResultSchema>;

export const diffModeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('head') }),
  z.object({ kind: z.literal('staged') }),
]);
export type DiffMode = z.infer<typeof diffModeSchema>;

export const gitObjectRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('branch'), branch: gitBranchRefSchema }),
  z.object({ kind: z.literal('commit'), sha: z.string() }),
  z.object({ kind: z.literal('tag'), name: z.string() }),
]);
export type GitObjectRef = z.infer<typeof gitObjectRefSchema>;

export const mergeBaseRangeSchema = z.object({
  base: gitObjectRefSchema,
  head: gitObjectRefSchema,
});
export type MergeBaseRange = z.infer<typeof mergeBaseRangeSchema>;

export const diffTargetSchema = z.union([diffModeSchema, gitObjectRefSchema, mergeBaseRangeSchema]);
export type DiffTarget = z.infer<typeof diffTargetSchema>;

export function toRefString(ref: GitObjectRef): string {
  switch (ref.kind) {
    case 'branch':
      return ref.branch.type === 'remote'
        ? `${ref.branch.remote.name}/${ref.branch.branch}`
        : ref.branch.branch;
    case 'commit':
      return ref.sha;
    case 'tag':
      return ref.name;
  }
}

export function toRangeString(range: MergeBaseRange): string {
  return `${toRefString(range.base)}...${toRefString(range.head)}`;
}

// -- Mutation option shapes --

// GitLogOptions.base/head are restricted to GitObjectRef (branch|commit|tag only)
export const gitLogOptionsSchema = z.object({
  limit: z.number().int().optional(),
  skip: z.number().int().optional(),
  base: gitObjectRefSchema.optional(),
  head: gitObjectRefSchema.optional(),
});
export type GitLogOptions = z.infer<typeof gitLogOptionsSchema>;

export const commitOptionsSchema = z.object({
  amend: z.boolean().optional(),
  signoff: z.boolean().optional(),
  noVerify: z.boolean().optional(),
  allowEmpty: z.boolean().optional(),
});
export type CommitOptions = z.infer<typeof commitOptionsSchema>;

export const resetModeSchema = z.enum(['soft', 'mixed', 'hard']);
export type ResetMode = z.infer<typeof resetModeSchema>;

export const switchOptionsSchema = z.object({
  /** Ref to switch to (branch name, tag, or commit SHA). */
  ref: z.string(),
  /** Create a new branch at this ref. */
  newBranch: z.string().optional(),
  /** Force switch even when local changes exist (discard). */
  force: z.boolean().optional(),
});
export type SwitchOptions = z.infer<typeof switchOptionsSchema>;

export const mergeOptionsSchema = z.object({
  branch: z.string(),
  /** Prevent fast-forward; always create a merge commit. */
  noFf: z.boolean().optional(),
  squash: z.boolean().optional(),
  message: z.string().optional(),
});
export type MergeOptions = z.infer<typeof mergeOptionsSchema>;

export const rebaseOptionsSchema = z.object({
  /** Branch / ref to rebase onto. */
  onto: z.string(),
  /** Interactive (implies passing --interactive to git, not modelled further here). */
  interactive: z.boolean().optional(),
});
export type RebaseOptions = z.infer<typeof rebaseOptionsSchema>;

export const pushOptionsSchema = z.object({
  remote: z.string().optional(),
  force: z.boolean().optional(),
  setUpstream: z.boolean().optional(),
});
export type PushOptions = z.infer<typeof pushOptionsSchema>;

export const stashPushOptionsSchema = z.object({
  message: z.string().optional(),
  includeUntracked: z.boolean().optional(),
  keepIndex: z.boolean().optional(),
  paths: z.array(z.string()).optional(),
});
export type StashPushOptions = z.infer<typeof stashPushOptionsSchema>;

// -- Job inputs --

export const pushJobInputSchema = checkoutKeySchema.extend({
  options: pushOptionsSchema.optional(),
});
export type PushJobInput = z.infer<typeof pushJobInputSchema>;

export const pullJobInputSchema = checkoutKeySchema;
export type PullJobInput = z.infer<typeof pullJobInputSchema>;

export const syncJobInputSchema = checkoutKeySchema;
export type SyncJobInput = z.infer<typeof syncJobInputSchema>;
