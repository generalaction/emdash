import { z } from 'zod';

import { gitObjectRefSchema } from './queries';

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
