import { defineContract, fallible, liveJob, liveModel, liveState, mutation } from '@emdash/wire';
import { z } from 'zod';
import {
  createBranchErrorSchema,
  deleteBranchErrorSchema,
  fetchErrorSchema,
  fetchPrForReviewErrorSchema,
  gitCommandErrorSchema,
  pushErrorSchema,
} from '../api/errors';
import { transferProgressSchema } from '../api/schemas';
import { repositorySelectorSchema } from '../api/selectors';
import {
  addWorktreeOptionsSchema,
  explicitCreateBranchOptionsSchema,
  explicitTagOptionsSchema,
  fetchJobInputSchema,
  fetchPrForReviewJobInputSchema,
  publishBranchJobInputSchema,
} from './schemas';
import { gitRefsStateSchema } from './states/refs';
import { gitRemotesStateSchema } from './states/remotes';
import { gitStashesStateSchema } from './states/stashes';
import { gitWorktreesStateSchema, worktreeSummarySchema } from './states/worktrees';

export const gitRepositoryContract = defineContract({
  model: liveModel({
    key: repositorySelectorSchema,
    states: {
      refs: liveState({ data: gitRefsStateSchema }),
      remotes: liveState({ data: gitRemotesStateSchema }),
      stashes: liveState({ data: gitStashesStateSchema }),
      worktrees: liveState({ data: gitWorktreesStateSchema }),
    },
    mutations: {
      createBranch: mutation({
        input: z.object({ options: explicitCreateBranchOptionsSchema }),
        data: z.void(),
        error: createBranchErrorSchema,
      }),
      deleteBranch: mutation({
        input: z.object({ branch: z.string(), force: z.boolean().optional() }),
        data: z.void(),
        error: deleteBranchErrorSchema,
      }),
      renameBranch: mutation({
        input: z.object({ oldName: z.string(), newName: z.string() }),
        data: z.void(),
        error: gitCommandErrorSchema,
      }),
      setUpstream: mutation({
        input: z.object({ branch: z.string(), upstream: z.string().nullable() }),
        data: z.void(),
        error: gitCommandErrorSchema,
      }),
      createTag: mutation({
        input: z.object({ options: explicitTagOptionsSchema }),
        data: z.void(),
        error: gitCommandErrorSchema,
      }),
      deleteTag: mutation({
        input: z.object({ name: z.string() }),
        data: z.void(),
        error: gitCommandErrorSchema,
      }),
      addRemote: mutation({
        input: z.object({ name: z.string(), url: z.string() }),
        data: z.void(),
        error: gitCommandErrorSchema,
      }),
      removeRemote: mutation({
        input: z.object({ name: z.string() }),
        data: z.void(),
        error: gitCommandErrorSchema,
      }),
      stashDrop: mutation({
        input: z.object({ stashIndex: z.number().int().nonnegative() }),
        data: z.void(),
        error: gitCommandErrorSchema,
      }),
      addWorktree: mutation({
        input: z.object({ options: addWorktreeOptionsSchema }),
        data: worktreeSummarySchema,
        error: gitCommandErrorSchema,
      }),
      removeWorktree: mutation({
        input: z.object({ worktreePath: z.string(), force: z.boolean().optional() }),
        data: z.void(),
        error: gitCommandErrorSchema,
      }),
      pruneWorktrees: mutation({
        input: z.object({}),
        data: z.void(),
        error: gitCommandErrorSchema,
      }),
    },
  }),

  listWorktrees: fallible({
    input: repositorySelectorSchema,
    data: gitWorktreesStateSchema,
    error: gitCommandErrorSchema,
  }),
  getDefaultBranch: fallible({
    input: repositorySelectorSchema.extend({ remote: z.string().optional() }),
    data: z.string(),
    error: gitCommandErrorSchema,
  }),
  readBlobAtRef: fallible({
    input: repositorySelectorSchema.extend({ ref: z.string(), filePath: z.string() }),
    data: z.string().nullable(),
    error: gitCommandErrorSchema,
  }),

  fetch: liveJob({
    input: fetchJobInputSchema,
    progress: transferProgressSchema,
    result: z.void(),
    error: fetchErrorSchema,
  }),
  publishBranch: liveJob({
    input: publishBranchJobInputSchema,
    progress: transferProgressSchema,
    result: z.object({ output: z.string() }),
    error: pushErrorSchema,
  }),
  fetchPrForReview: liveJob({
    input: fetchPrForReviewJobInputSchema,
    progress: transferProgressSchema,
    result: z.void(),
    error: fetchPrForReviewErrorSchema,
  }),
});

export type GitRepositoryContract = typeof gitRepositoryContract;
