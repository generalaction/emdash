import { defineContract, fallible, liveJob, liveModel, liveState, mutation } from '@emdash/wire';
import { hostAbsolutePathSchema } from '@primitives/path/api';
import {
  createBranchErrorSchema,
  deleteBranchErrorSchema,
  fetchErrorSchema,
  fetchPrForReviewErrorSchema,
  gitCommandErrorSchema,
  pushErrorSchema,
} from '@runtimes/git/api/api/errors';
import { transferProgressSchema } from '@runtimes/git/api/api/schemas';
import { repositorySelectorSchema } from '@runtimes/git/api/api/selectors';
import { gitFilePathSchema } from '@runtimes/git/api/checkout/schemas';
import { gitRefsStateSchema } from '@runtimes/git/api/repository/states/refs';
import { gitRemotesStateSchema } from '@runtimes/git/api/repository/states/remotes';
import { gitStashesStateSchema } from '@runtimes/git/api/repository/states/stashes';
import {
  gitWorktreesStateSchema,
  worktreeSummarySchema,
} from '@runtimes/git/api/repository/states/worktrees';
import { z } from 'zod';
import {
  addWorktreeOptionsSchema,
  explicitCreateBranchOptionsSchema,
  explicitTagOptionsSchema,
  fetchJobInputSchema,
  fetchPrForReviewJobInputSchema,
  publishBranchJobInputSchema,
} from './schemas';

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
      setBranchBase: mutation({
        input: z.object({ branch: z.string(), base: z.string() }),
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
      setRemoteUrl: mutation({
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
        input: z.object({
          worktreePath: hostAbsolutePathSchema,
          force: z.boolean().optional(),
        }),
        data: z.void(),
        error: gitCommandErrorSchema,
      }),
      moveWorktree: mutation({
        input: z.object({ from: hostAbsolutePathSchema, to: hostAbsolutePathSchema }),
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
  getBranchBase: fallible({
    input: repositorySelectorSchema.extend({ branch: z.string() }),
    data: z.string().nullable(),
    error: gitCommandErrorSchema,
  }),
  readBlobAtRef: fallible({
    input: repositorySelectorSchema.extend({
      ref: z.string(),
      filePath: gitFilePathSchema,
    }),
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
