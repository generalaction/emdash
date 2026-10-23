import {
  pullRequestCommentSchema,
  pullRequestLabelSchema,
  pullRequestMergeOptionsSchema,
  pullRequestSchema,
  pullRequestUserSchema,
} from '@emdash/plugins/pull-requests/schemas';
import { z } from 'zod';
import { pullRequestErrorSchema } from './errors';

export const pullRequestStatusFilterSchema = z.enum([
  'open',
  'closed',
  'merged',
  'all',
  'not-open',
]);

export const pullRequestFiltersSchema = z.object({
  status: pullRequestStatusFilterSchema.optional(),
  authorUserIds: z.array(z.string()).optional(),
  labelNames: z.array(z.string()).optional(),
  assigneeUserIds: z.array(z.string()).optional(),
});

export const pullRequestSortSchema = z.enum(['newest', 'oldest', 'recently-updated']);

export const listPullRequestsInputSchema = z.object({
  repositoryUrls: z.array(z.string()).min(1),
  cursor: z.string().nullable(),
  limit: z.number().int().positive().max(200).default(50),
  searchQuery: z.string().optional(),
  filters: pullRequestFiltersSchema.optional(),
  sort: pullRequestSortSchema.optional(),
});

export const listPullRequestsResultSchema = z.object({
  prs: z.array(pullRequestSchema),
  nextCursor: z.string().nullable(),
});

export const pullRequestFilterOptionsSchema = z.object({
  authors: z.array(pullRequestUserSchema),
  labels: z.array(pullRequestLabelSchema),
  assignees: z.array(pullRequestUserSchema),
});

export const repositoryInputSchema = z.object({
  repositoryUrl: z.string(),
});

export const repositoryListInputSchema = z.object({
  repositoryUrls: z.array(z.string()).min(1),
});

export const branchPullRequestsInputSchema = repositoryInputSchema.extend({
  branch: z.string(),
});

export const headPullRequestsInputSchema = repositoryInputSchema.extend({
  headRepositoryUrl: z.string(),
  headRefName: z.string(),
});

export const pullRequestNumberInputSchema = repositoryInputSchema.extend({
  number: z.number().int().positive(),
});

/** Automatic activation may reuse observations younger than 60 seconds; force always re-reads. */
export const refreshPolicySchema = z.enum(['if-stale', 'force']);

export const refreshRepositoryInputSchema = repositoryInputSchema.extend({
  policy: refreshPolicySchema,
});

export const refreshPullRequestInputSchema = pullRequestNumberInputSchema.extend({
  comments: z.boolean().optional(),
  policy: refreshPolicySchema,
});

export const pullRequestDetailsKeySchema = pullRequestNumberInputSchema.extend({
  comments: z.boolean().default(false),
});

export const pullRequestDetailsSchema = z.object({
  pr: pullRequestSchema.nullable(),
  comments: z.array(pullRequestCommentSchema),
  commentsFetchedAt: z.number().nullable(),
  refreshing: z.boolean(),
  stale: z.boolean(),
  errors: z.object({
    metadata: pullRequestErrorSchema.optional(),
    checks: pullRequestErrorSchema.optional(),
    comments: pullRequestErrorSchema.optional(),
  }),
});

export const pullRequestUrlInputSchema = repositoryInputSchema.extend({
  url: z.string(),
});

export const createPullRequestInputSchema = z.object({
  repositoryUrl: z.string(),
  headRepositoryUrl: z.string().optional(),
  head: z.string(),
  base: z.string(),
  title: z.string(),
  body: z.string().optional(),
  draft: z.boolean(),
});

export const mergePullRequestInputSchema = pullRequestNumberInputSchema.extend({
  options: pullRequestMergeOptionsSchema,
});

export const syncStateSchema = z.object({
  phase: z.enum(['idle', 'running', 'error']),
  kind: z.enum(['repository', 'history']).nullable(),
  outcome: z.enum(['success', 'cancelled']).optional(),
  synced: z.number().int().nonnegative().optional(),
  total: z.number().int().nonnegative().optional(),
  error: pullRequestErrorSchema.optional(),
  lastSyncedAt: z.number().int().nonnegative().optional(),
  revision: z.number().int().nonnegative().optional(),
});

export const syncStateKeySchema = repositoryInputSchema;

export type PullRequestFilters = z.infer<typeof pullRequestFiltersSchema>;
export type PullRequestSort = z.infer<typeof pullRequestSortSchema>;
export type ListPullRequestsInput = z.infer<typeof listPullRequestsInputSchema>;
export type ListPullRequestsResult = z.infer<typeof listPullRequestsResultSchema>;
export type PullRequestFilterOptions = z.infer<typeof pullRequestFilterOptionsSchema>;
export type CreatePullRequestInput = z.infer<typeof createPullRequestInputSchema>;
export type SyncState = z.infer<typeof syncStateSchema>;
export type PullRequestDetails = z.infer<typeof pullRequestDetailsSchema>;
export type RefreshPolicy = z.infer<typeof refreshPolicySchema>;
export type RefreshRepositoryInput = z.infer<typeof refreshRepositoryInputSchema>;
export type RefreshPullRequestInput = z.input<typeof refreshPullRequestInputSchema>;
