import {
  defineContract,
  fallible,
  liveJob,
  liveModel,
  liveState,
  mutation,
  procedure,
} from '@emdash/wire';
import { z } from 'zod';
import {
  createBranchErrorSchema,
  deleteBranchErrorSchema,
  fetchErrorSchema,
  fetchPrForReviewErrorSchema,
  gitCommandErrorSchema,
  pushErrorSchema,
} from '../api/errors';
import { checkoutInfoSchema, transferProgressSchema } from '../api/schemas';
import { repositoryKeySchema } from './key';
import { gitCheckoutsModelSchema } from './models/checkouts';
import { gitRefsModelSchema } from './models/refs';
import { gitRemotesModelSchema } from './models/remotes';
import { gitStashesModelSchema } from './models/stashes';
import {
  addCheckoutOptionsSchema,
  createBranchOptionsSchema,
  fetchJobInputSchema,
  fetchPrForReviewJobInputSchema,
  publishBranchJobInputSchema,
  tagOptionsSchema,
} from './schemas';

export const gitRepositoryContract = defineContract({
  model: liveModel({
    key: repositoryKeySchema,
    states: {
      refs: liveState({ data: gitRefsModelSchema }),
      remotes: liveState({ data: gitRemotesModelSchema }),
      stashes: liveState({ data: gitStashesModelSchema }),
      checkouts: liveState({ data: gitCheckoutsModelSchema }),
    },
    mutations: {
      createBranch: mutation({
        input: z.object({ options: createBranchOptionsSchema }),
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
        input: z.object({ options: tagOptionsSchema }),
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
      addCheckout: mutation({
        input: z.object({ options: addCheckoutOptionsSchema }),
        data: checkoutInfoSchema,
        error: gitCommandErrorSchema,
      }),
      removeCheckout: mutation({
        input: z.object({ checkoutPath: z.string(), force: z.boolean().optional() }),
        data: z.void(),
        error: gitCommandErrorSchema,
      }),
      pruneCheckouts: mutation({
        input: z.object({}),
        data: z.void(),
        error: gitCommandErrorSchema,
      }),
    },
  }),

  open: fallible({
    input: z.object({ path: z.string() }),
    data: repositoryKeySchema,
    error: gitCommandErrorSchema,
  }),
  close: procedure({ input: repositoryKeySchema, output: z.void() }),

  listCheckouts: fallible({
    input: repositoryKeySchema,
    data: z.array(checkoutInfoSchema),
    error: gitCommandErrorSchema,
  }),
  getDefaultBranch: fallible({
    input: repositoryKeySchema.extend({ remote: z.string().optional() }),
    data: z.string(),
    error: gitCommandErrorSchema,
  }),
  readBlobAtRef: fallible({
    input: repositoryKeySchema.extend({ ref: z.string(), filePath: z.string() }),
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
