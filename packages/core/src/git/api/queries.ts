import { z } from 'zod';

import { gitHeadModelSchema } from '../checkout/models/head';
import { gitBranchRefSchema } from '../repository/models/refs';

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
