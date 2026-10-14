import { z } from 'zod';

export const pullRequestStatusSchema = z.enum(['open', 'closed', 'merged']);
export const mergeableStateSchema = z.enum(['MERGEABLE', 'CONFLICTING', 'UNKNOWN']);
export const mergeStateStatusSchema = z.enum([
  'CLEAN',
  'DIRTY',
  'BEHIND',
  'BLOCKED',
  'HAS_HOOKS',
  'UNSTABLE',
  'UNKNOWN',
]);
export const pullRequestMergeStrategySchema = z.enum(['merge', 'squash', 'rebase']);

export const pullRequestUserSchema = z.object({
  userId: z.string(),
  userName: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  url: z.string().nullable(),
  userUpdatedAt: z.string().nullable(),
  userCreatedAt: z.string().nullable(),
});

export const pullRequestLabelSchema = z.object({
  name: z.string(),
  color: z.string().nullable(),
});

export const pullRequestCheckSchema = z.object({
  id: z.string(),
  pullRequestUrl: z.string(),
  commitSha: z.string(),
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  detailsUrl: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  workflowName: z.string().nullable(),
  appName: z.string().nullable(),
  appLogoUrl: z.string().nullable(),
});

export const pullRequestCommentSchema = z.object({
  id: z.string(),
  pullRequestUrl: z.string(),
  kind: z.enum(['issue', 'review']),
  body: z.string(),
  url: z.string(),
  author: pullRequestUserSchema.nullable(),
  path: z.string().nullable(),
  line: z.number().int().nullable(),
  isResolved: z.boolean(),
  isOutdated: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const pullRequestSchema = z.object({
  url: z.string(),
  provider: z.string(),
  repositoryUrl: z.string(),
  baseRefName: z.string(),
  baseRefOid: z.string(),
  headRepositoryUrl: z.string(),
  headRefName: z.string(),
  headRefOid: z.string(),
  identifier: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  status: pullRequestStatusSchema,
  isDraft: z.boolean(),
  additions: z.number().int().nullable(),
  deletions: z.number().int().nullable(),
  changedFiles: z.number().int().nullable(),
  commitCount: z.number().int().nullable(),
  mergeableStatus: mergeableStateSchema.nullable(),
  mergeStateStatus: mergeStateStatusSchema.nullable(),
  reviewDecision: z.string().nullable(),
  checkSummary: z
    .enum(['SUCCESS', 'FAILURE', 'ERROR', 'PENDING', 'EXPECTED'])
    .nullable()
    .optional(),
  metadataFetchedAt: z.number().nullable().optional(),
  checksFetchedAt: z.number().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  author: pullRequestUserSchema.nullable(),
  labels: z.array(pullRequestLabelSchema),
  assignees: z.array(pullRequestUserSchema),
  checks: z.array(pullRequestCheckSchema),
});

export const pullRequestFileSchema = z.object({
  filename: z.string(),
  status: z.string(),
  additions: z.number().int(),
  deletions: z.number().int(),
  patch: z.string().optional(),
});

export const pullRequestMergeOptionsSchema = z.object({
  strategy: pullRequestMergeStrategySchema,
  commitHeadOid: z.string().optional(),
  bypassRequirements: z.boolean().optional(),
});

export const pullRequestErrorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('invalid_repository'), input: z.string() }),
  z.object({ type: z.literal('remote_not_ready'), status: z.string() }),
  z.object({ type: z.literal('cross_host_pr'), baseHost: z.string(), headHost: z.string() }),
  z.object({ type: z.literal('host_unreachable'), host: z.string(), reason: z.string() }),
  z.object({ type: z.literal('unsupported_provider'), host: z.string(), reason: z.string() }),
  /** `integrationId` names the integration whose account must be connected or fixed. */
  z.object({
    type: z.literal('auth_required'),
    integrationId: z.string(),
    host: z.string(),
    hint: z.string(),
  }),
  z.object({
    type: z.literal('integration_disabled'),
    integrationId: z.string(),
    message: z.string(),
  }),
  z.object({
    type: z.literal('account_not_found'),
    integrationId: z.string(),
    message: z.string(),
    accountId: z.string().optional(),
    host: z.string().optional(),
  }),
  z.object({
    type: z.literal('account_host_mismatch'),
    integrationId: z.string(),
    message: z.string(),
    accountId: z.string(),
    accountHost: z.string(),
    host: z.string(),
  }),
  z.object({
    type: z.literal('token_missing'),
    integrationId: z.string(),
    message: z.string(),
    accountId: z.string(),
    host: z.string(),
  }),
  z.object({
    type: z.literal('sso_required'),
    integrationId: z.string(),
    host: z.string(),
    message: z.string(),
    ssoUrl: z.string().optional(),
  }),
  z.object({
    type: z.literal('not_found_or_no_access'),
    host: z.string(),
    message: z.string(),
  }),
  z.object({
    type: z.literal('rate_limited'),
    host: z.string(),
    message: z.string(),
    resetAt: z.string().optional(),
  }),
  z.object({ type: z.literal('forbidden'), host: z.string(), message: z.string() }),
  z.object({ type: z.literal('list_failed'), message: z.string() }),
  z.object({ type: z.literal('filter_options_failed'), message: z.string() }),
  z.object({ type: z.literal('task_pull_requests_failed'), message: z.string() }),
  z.object({ type: z.literal('sync_failed'), message: z.string() }),
  z.object({ type: z.literal('refresh_failed'), message: z.string() }),
  z.object({ type: z.literal('checks_failed'), message: z.string() }),
  z.object({ type: z.literal('comments_failed'), message: z.string() }),
  z.object({ type: z.literal('create_failed'), message: z.string() }),
  z.object({ type: z.literal('merge_failed'), message: z.string() }),
  z.object({ type: z.literal('mark_ready_failed'), message: z.string() }),
  z.object({ type: z.literal('files_failed'), message: z.string() }),
  z.object({ type: z.literal('repository_not_registered'), repositoryUrl: z.string() }),
]);

export const pullRequestAuthErrorSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('auth_required'),
    host: z.string(),
    message: z.string(),
    hint: z.string().optional(),
  }),
  z.object({
    type: z.literal('account_not_found'),
    host: z.string(),
    accountId: z.string(),
    message: z.string(),
    hint: z.string().optional(),
  }),
  z.object({
    type: z.literal('account_host_mismatch'),
    host: z.string(),
    accountId: z.string(),
    accountHost: z.string(),
    message: z.string(),
    hint: z.string().optional(),
  }),
  z.object({
    type: z.literal('token_missing'),
    host: z.string(),
    accountId: z.string(),
    message: z.string(),
    hint: z.string().optional(),
  }),
  /**
   * Fail-closed identity resolution failure (spec: github-git-settings §8): the
   * effective account for the repository cannot be produced — a broken pin, a
   * resolution error, or no open project referencing the repository. The sync
   * is skipped; never run as a fallback identity.
   */
  z.object({
    type: z.literal('account_unresolvable'),
    host: z.string(),
    message: z.string(),
    hint: z.string().optional(),
  }),
  /** The project explicitly disabled the integration (for GitHub, `githubAccount: { kind: 'none' }`). */
  z.object({
    type: z.literal('integration_disabled'),
    host: z.string(),
    message: z.string(),
    hint: z.string().optional(),
  }),
]);

export type PullRequestStatus = z.infer<typeof pullRequestStatusSchema>;
export type MergeableState = z.infer<typeof mergeableStateSchema>;
export type MergeStateStatus = z.infer<typeof mergeStateStatusSchema>;
export type PullRequestMergeStrategy = z.infer<typeof pullRequestMergeStrategySchema>;
export type PullRequestMergeOptions = z.infer<typeof pullRequestMergeOptionsSchema>;
export type PullRequestUser = z.infer<typeof pullRequestUserSchema>;
export type PullRequestLabel = z.infer<typeof pullRequestLabelSchema>;
export type PullRequestCheck = z.infer<typeof pullRequestCheckSchema>;
export type PullRequestComment = z.infer<typeof pullRequestCommentSchema>;
export type PullRequest = z.infer<typeof pullRequestSchema>;
export type PullRequestFile = z.infer<typeof pullRequestFileSchema>;
export type PullRequestError = z.infer<typeof pullRequestErrorSchema>;
export type PullRequestAuthError = z.infer<typeof pullRequestAuthErrorSchema>;
