export type GitPlatform = 'github' | 'gitlab';

export const DEFAULT_GIT_PLATFORM: GitPlatform = 'github';

export interface GitPlatformPullRequestReviewer {
  login: string;
  state?: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
}

export interface GitPlatformPullRequestSummary {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  url: string;
  isDraft?: boolean;
  updatedAt?: string | null;
  author?: { login?: string; name?: string } | null;
  reviewDecision?: string | null;
  reviewers?: GitPlatformPullRequestReviewer[];
  additions?: number;
  deletions?: number;
  checksStatus?: 'pass' | 'fail' | 'pending' | 'none' | null;
}

export interface GitPlatformListPullRequestsArgs {
  projectPath: string;
  limit?: number;
  searchQuery?: string;
}

export interface GitPlatformListPullRequestsResult {
  success: boolean;
  prs?: GitPlatformPullRequestSummary[];
  totalCount?: number;
  error?: string;
}

export interface GitPlatformReviewTaskRef {
  id: string;
  name: string;
  path: string;
  branch: string;
  projectId: string;
  status: string;
  agentId?: string | null;
  metadata?: { prNumber?: number; prTitle?: string | null };
}

export interface GitPlatformWorktreeRef {
  id?: string;
  name?: string;
  branch?: string;
  path?: string;
  projectId?: string;
  status?: string;
}

export interface GitPlatformCreateReviewWorktreeArgs {
  projectPath: string;
  projectId: string;
  prNumber: number;
  prTitle?: string;
  taskName?: string;
  branchName?: string;
}

export interface GitPlatformCreateReviewWorktreeResult {
  success: boolean;
  worktree?: GitPlatformWorktreeRef;
  branchName?: string;
  taskName?: string;
  task?: GitPlatformReviewTaskRef;
  error?: string;
}

export interface GitPlatformGetPullRequestBaseDiffArgs {
  worktreePath: string;
  prNumber: number;
}

export interface GitPlatformGetPullRequestBaseDiffResult {
  success: boolean;
  diff?: string;
  baseBranch?: string;
  headBranch?: string;
  prUrl?: string;
  error?: string;
}

type GitPlatformMatcher = {
  id: GitPlatform;
  matchesHost: (host: string) => boolean;
};

const GIT_PLATFORM_MATCHERS: GitPlatformMatcher[] = [
  {
    id: 'gitlab',
    matchesHost: (host) => host === 'gitlab.com' || host.startsWith('gitlab.'),
  },
  {
    id: 'github',
    matchesHost: (host) => host === 'github.com' || host.startsWith('github.'),
  },
];

/**
 * Detect the git platform from a remote URL.
 * Matches gitlab.com, self-hosted gitlab.xxx.yy, and git@gitlab.*: patterns.
 */
export function detectGitPlatformFromRemote(remote?: string | null): GitPlatform {
  if (!remote) return DEFAULT_GIT_PLATFORM;
  const lower = remote.toLowerCase();

  // Extract hostname from ssh (git@host:path) or https (https://host/path)
  const sshMatch = lower.match(/^[^@]+@([^:/]+)/);
  const urlMatch = lower.match(/^https?:\/\/([^/:]+)/);
  const host = sshMatch?.[1] || urlMatch?.[1] || '';

  for (const matcher of GIT_PLATFORM_MATCHERS) {
    if (matcher.matchesHost(host)) {
      return matcher.id;
    }
  }
  return DEFAULT_GIT_PLATFORM;
}
