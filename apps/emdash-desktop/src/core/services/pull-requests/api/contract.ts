import { defineContract, fallible, liveModel, liveState } from '@emdash/wire/rpc';
import { z } from 'zod';
import { pullRequestErrorSchema } from './errors';
import {
  branchPullRequestsInputSchema,
  createPullRequestInputSchema,
  headPullRequestsInputSchema,
  listPullRequestsInputSchema,
  listPullRequestsResultSchema,
  mergePullRequestInputSchema,
  pullRequestFileSchema,
  pullRequestFilterOptionsSchema,
  pullRequestNumberInputSchema,
  pullRequestSchema,
  pullRequestUrlInputSchema,
  repositoryInputSchema,
  repositoryListInputSchema,
  syncStateKeySchema,
  syncStateSchema,
  refreshPullRequestInputSchema,
  refreshRepositoryInputSchema,
  pullRequestDetailsKeySchema,
  pullRequestDetailsSchema,
} from './schemas';

export const pullRequestsDomain = 'pullRequests' as const;

export const pullRequestsContract = defineContract({
  listPullRequests: fallible({
    input: listPullRequestsInputSchema,
    data: listPullRequestsResultSchema,
    error: pullRequestErrorSchema,
  }),
  getFilterOptions: fallible({
    input: repositoryListInputSchema,
    data: pullRequestFilterOptionsSchema,
    error: pullRequestErrorSchema,
  }),
  /** Broad cache-refresh discovery; checkout association must use the exact-head read below. */
  getPullRequestsForBranch: fallible({
    input: branchPullRequestsInputSchema,
    data: z.object({ prs: z.array(pullRequestSchema) }),
    error: pullRequestErrorSchema,
  }),
  /** Exact head identity lookup used for checkout-to-PR association. */
  getPullRequestsForHead: fallible({
    input: headPullRequestsInputSchema,
    data: z.object({ prs: z.array(pullRequestSchema) }),
    error: pullRequestErrorSchema,
  }),
  /**
   * Breadcrumb validation read (pr-workspace-model spec, Association): the cache's
   * PR for a canonical PR URL, scoped to one registered repository. `pr` is null
   * when the URL is unknown to the cache — never an error, so a stale breadcrumb
   * degrades silently to the caller's fallback.
   */
  getPullRequestByUrl: fallible({
    input: pullRequestUrlInputSchema,
    data: z.object({ pr: pullRequestSchema.nullable() }),
    error: pullRequestErrorSchema,
  }),
  registerRepository: fallible({
    input: repositoryInputSchema,
    data: z.void(),
    error: pullRequestErrorSchema,
  }),
  unregisterRepository: fallible({
    input: repositoryInputSchema,
    data: z.void(),
    error: pullRequestErrorSchema,
  }),
  refreshRepository: fallible({
    input: refreshRepositoryInputSchema,
    data: z.void(),
    error: pullRequestErrorSchema,
  }),
  refreshHistory: fallible({
    input: repositoryInputSchema,
    data: z.void(),
    error: pullRequestErrorSchema,
  }),
  refreshPullRequest: fallible({
    input: refreshPullRequestInputSchema,
    data: z.void(),
    error: pullRequestErrorSchema,
  }),
  details: liveModel({
    key: pullRequestDetailsKeySchema,
    states: { state: liveState({ data: pullRequestDetailsSchema }) },
  }),
  releaseRepository: fallible({
    input: repositoryInputSchema,
    data: z.void(),
    error: pullRequestErrorSchema,
  }),
  createPullRequest: fallible({
    input: createPullRequestInputSchema,
    data: z.object({ url: z.string(), number: z.number().int().positive() }),
    error: pullRequestErrorSchema,
  }),
  mergePullRequest: fallible({
    input: mergePullRequestInputSchema,
    data: z.object({ sha: z.string().nullable(), merged: z.boolean() }),
    error: pullRequestErrorSchema,
  }),
  markReadyForReview: fallible({
    input: pullRequestNumberInputSchema,
    data: z.void(),
    error: pullRequestErrorSchema,
  }),
  getPullRequestFiles: fallible({
    input: pullRequestNumberInputSchema,
    data: z.object({ files: z.array(pullRequestFileSchema) }),
    error: pullRequestErrorSchema,
  }),
  syncState: liveModel({
    key: syncStateKeySchema,
    states: {
      state: liveState({ data: syncStateSchema }),
    },
  }),
});

export type PullRequestsContract = typeof pullRequestsContract;
