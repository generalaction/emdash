import { match, P } from 'ts-pattern';

export type PullRequestStatus = 'open' | 'closed' | 'merged';

export type MergeableState = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';

export type MergeStateStatus =
  | 'CLEAN'
  | 'DIRTY'
  | 'BEHIND'
  | 'BLOCKED'
  | 'HAS_HOOKS'
  | 'UNSTABLE'
  | 'UNKNOWN';

export type PullRequestMergeStrategy = 'merge' | 'squash' | 'rebase';

export type PullRequestMergeOptions = {
  strategy: PullRequestMergeStrategy;
  commitHeadOid?: string;
  bypassRequirements?: boolean;
};

export type PullRequestUser = {
  userId: string;
  userName: string;
  displayName: string | null;
  avatarUrl: string | null;
  url: string | null;
  userUpdatedAt: string | null;
  userCreatedAt: string | null;
};

export type Label = {
  name: string;
  color: string | null;
};

export type PullRequestCheck = {
  id: string;
  pullRequestUrl: string;
  commitSha: string;
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
  workflowName: string | null;
  appName: string | null;
  appLogoUrl: string | null;
};

export type PullRequestCommentKind = 'issue' | 'review';

export type PullRequestComment = {
  id: string;
  pullRequestUrl: string;
  kind: PullRequestCommentKind;
  body: string;
  url: string;
  author: PullRequestUser | null;
  path: string | null;
  line: number | null;
  isResolved: boolean;
  isOutdated: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Fully denormalised PR view used throughout the renderer. */
export type PullRequest = {
  url: string;
  provider: string;
  repositoryUrl: string;
  baseRefName: string;
  baseRefOid: string;
  headRepositoryUrl: string;
  headRefName: string;
  headRefOid: string;
  identifier: string | null;
  title: string;
  description: string | null;
  status: PullRequestStatus;
  isDraft: boolean;
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
  commitCount: number | null;
  mergeableStatus: MergeableState | null;
  mergeStateStatus: MergeStateStatus | null;
  reviewDecision: string | null;
  createdAt: string;
  updatedAt: string;
  author: PullRequestUser | null;
  labels: Label[];
  assignees: PullRequestUser[];
  checks: PullRequestCheck[];
};

// ── Sync progress ─────────────────────────────────────────────────────────────

export type PrSyncProgress = {
  remoteUrl: string;
  kind: 'full' | 'incremental' | 'single';
  status: 'running' | 'done' | 'error' | 'cancelled';
  synced?: number;
  total?: number;
  error?: string;
};

// ── Query options ─────────────────────────────────────────────────────────────

export type PullRequestStatusFilter = PullRequestStatus | 'all' | 'not-open';

export type PrFilters = {
  status?: PullRequestStatusFilter;
  authorUserIds?: string[];
  labelNames?: string[];
  assigneeUserIds?: string[];
};

export type PrSortField = 'newest' | 'oldest' | 'recently-updated';

export type ListPrOptions = {
  limit?: number;
  offset?: number;
  searchQuery?: string;
  filters?: PrFilters;
  sort?: PrSortField;
  repositoryUrl?: string;
};

export type PrFilterOptions = {
  authors: PullRequestUser[];
  labels: Label[];
  assignees: PullRequestUser[];
};

export type RemoteNotReadyPullRequestError = { type: 'remote_not_ready'; status: string };

export type PullRequestAuthError =
  | { type: 'github_auth_required'; host: string; hint: string }
  | { type: 'ghes_auth_required'; host: string; hint: string }
  | { type: 'github_no_account_selected'; message: string }
  | { type: 'github_account_disabled'; message: string }
  | { type: 'github_account_not_found'; message: string; accountId?: string; host?: string }
  | {
      type: 'github_account_host_mismatch';
      message: string;
      accountId: string;
      accountHost: string;
      host: string;
    }
  | { type: 'github_token_missing'; message: string; accountId: string; host: string }
  | { type: 'github_not_found_or_no_access'; host: string; message: string }
  | { type: 'github_sso_required'; host: string; message: string; ssoUrl?: string }
  | { type: 'github_rate_limited'; host: string; message: string; resetAt?: string }
  | { type: 'github_forbidden'; host: string; message: string }
  | { type: 'github_account_resolution_failed'; message: string };

export type PullRequestRepositoryError =
  | { type: 'invalid_repository'; input: string }
  | RemoteNotReadyPullRequestError
  | { type: 'cross_host_pr'; baseHost: string; headHost: string }
  | { type: 'host_unreachable'; host: string; reason: string };

export type PullRequestOperationError =
  | { type: 'list_failed'; message: string }
  | { type: 'filter_options_failed'; message: string }
  | { type: 'task_pull_requests_failed'; message: string }
  | { type: 'sync_failed'; message: string }
  | { type: 'refresh_failed'; message: string }
  | { type: 'checks_failed'; message: string }
  | { type: 'comments_failed'; message: string }
  | { type: 'create_failed'; message: string }
  | { type: 'merge_failed'; message: string }
  | { type: 'mark_ready_failed'; message: string }
  | { type: 'files_failed'; message: string };

export type PullRequestError =
  | PullRequestRepositoryError
  | PullRequestAuthError
  | PullRequestOperationError;

// ── Pass-through types ────────────────────────────────────────────────────────

export interface PullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export function pullRequestErrorMessage(error: PullRequestError): string {
  return match(error)
    .with({ type: 'invalid_repository' }, (e) => `Invalid GitHub repository URL: "${e.input}"`)
    .with({ type: 'remote_not_ready' }, (e) => `Remote not ready: ${e.status}`)
    .with({ type: 'github_auth_required' }, (e) => `GitHub authentication required. ${e.hint}`)
    .with(
      { type: 'ghes_auth_required' },
      (e) => `GitHub Enterprise authentication required for ${e.host}. ${e.hint}`
    )
    .with(
      { type: 'cross_host_pr' },
      (e) =>
        `Cannot create a pull request across different GitHub hosts (${e.headHost} -> ${e.baseHost}). Push and base remotes must use the same GitHub or GitHub Enterprise host.`
    )
    .with({ type: 'host_unreachable' }, (e) => `Unable to reach GitHub host ${e.host}: ${e.reason}`)
    .with(
      P.union(
        { type: 'github_no_account_selected' },
        { type: 'github_account_disabled' },
        { type: 'github_account_not_found' },
        { type: 'github_account_host_mismatch' },
        { type: 'github_token_missing' },
        { type: 'github_not_found_or_no_access' },
        { type: 'github_sso_required' },
        { type: 'github_rate_limited' },
        { type: 'github_forbidden' },
        { type: 'github_account_resolution_failed' },
        { type: 'list_failed' },
        { type: 'filter_options_failed' },
        { type: 'task_pull_requests_failed' },
        { type: 'sync_failed' },
        { type: 'refresh_failed' },
        { type: 'checks_failed' },
        { type: 'comments_failed' },
        { type: 'create_failed' },
        { type: 'merge_failed' },
        { type: 'mark_ready_failed' },
        { type: 'files_failed' }
      ),
      (e) => e.message
    )
    .exhaustive();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the open PR if one exists, otherwise the most recently created PR.
 * Use this everywhere a single "current" PR needs to be displayed.
 */
export function selectCurrentPr(prs: PullRequest[]): PullRequest | undefined {
  if (prs.length === 0) return undefined;
  const open = prs.find((pr) => pr.status === 'open');
  if (open) return open;
  return prs.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b), prs[0]);
}

/** True when the PR originates from a fork (head repo differs from base repo). */
export function isForkPr(pr: PullRequest): boolean {
  return pr.headRepositoryUrl !== pr.repositoryUrl;
}

/**
 * Extract the numeric PR number from a `PullRequest` row.
 * The `identifier` field stores values like `"#123"`.
 */
export function getPrNumber(pr: { identifier: string | null }): number | null {
  if (!pr.identifier) return null;
  const n = parseInt(pr.identifier.replace('#', ''), 10);
  return isNaN(n) ? null : n;
}
