import {
  defineContract,
  fallible,
  liveJob,
  liveModel,
  liveState,
  mutation,
} from '@emdash/wire/rpc';
import { z } from 'zod';
import {
  fetchErrorSchema,
  fetchPrForReviewErrorSchema,
  gitCommandErrorSchema,
  pushErrorSchema,
} from '#runtimes/git/api/api/errors';
import { transferProgressSchema } from '#runtimes/git/api/api/schemas';
import { repositorySelectorSchema } from '#runtimes/git/api/api/selectors';
import { gitRefsStateSchema } from '#runtimes/git/api/repository/states/refs';
import { gitRemotesStateSchema } from '#runtimes/git/api/repository/states/remotes';
import { gitWorktreesStateSchema } from '#runtimes/git/api/repository/states/worktrees';
import {
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
    },
    mutations: {
      addRemote: mutation({
        input: z.object({ name: z.string(), url: z.string() }),
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
