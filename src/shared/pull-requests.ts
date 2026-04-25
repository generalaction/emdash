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

// ── Pass-through types ────────────────────────────────────────────────────────

export interface PullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
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

/**
 * Extract the GitHub `owner/repo` string from a normalised repository URL
 * (e.g. `https://github.com/owner/repo` → `"owner/repo"`).
 * Returns the URL unchanged if parsing fails.
 */
export function nameWithOwnerFromUrl(repositoryUrl: string): string {
  const match = /github\.com\/([^/]+\/[^/?#]+)/.exec(repositoryUrl);
  return match ? match[1] : repositoryUrl;
}

/**
 * Extract just the owner from a repository URL.
 * (e.g. `https://github.com/owner/repo` → `"owner"`).
 */
export function ownerFromUrl(repositoryUrl: string): string | undefined {
  const match = /github\.com\/([^/]+)/.exec(repositoryUrl);
  return match ? match[1] : undefined;
}
