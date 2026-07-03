import type { Result } from '@emdash/shared';

/** Canonical, provider-neutral issue shape. Providers map their vocabulary
 *  at the plugin edge; non-universal concepts stay optional. */
export type IssueData = {
  identifier: string;
  /** Override for compact UI display; null hides opaque provider ids. */
  displayIdentifier?: string | null;
  title: string;
  url?: string;
  description?: string;
  branchName?: string;
  status?: string;
  assignees?: string[];
  project?: string;
  updatedAt?: string;
};

/**
 * Inputs are normalized by the host before the plugin is invoked: `limit` is
 * defaulted and clamped, `searchTerm` is trimmed, and empty searches return
 * an empty list without a plugin call. Plugins may apply stricter API caps.
 */
export type IssueQueryOpts = {
  limit: number;
  /** Resolved repository URL, present when the descriptor requires it. */
  repositoryUrl?: string;
};

export type IssueSearchOpts = IssueQueryOpts & {
  /** Non-empty, trimmed search term. */
  searchTerm: string;
};

export type IssueGetOpts = {
  identifier: string;
  /** Resolved repository URL, present when the descriptor requires it. */
  repositoryUrl?: string;
};

/**
 * Everything the provider has on a single issue: the canonical fields plus
 * provider-specific enrichment (comments, activity, linked docs) formatted
 * as a markdown context string for agent prompts.
 */
export type IssueDetail = IssueData & {
  context?: string;
};

/**
 * Typed error channel for issue operations. Renderers branch on `type`
 * (reconnect prompt, retry-after, plain message); providers without richer
 * signals emit `generic`. Account-resolution failures are host concerns and
 * never originate from plugins.
 */
export type IssueError =
  | { type: 'auth_failed'; message: string }
  | { type: 'rate_limited'; message: string; resetAt?: string }
  | { type: 'not_found_or_no_access'; message: string }
  | { type: 'sso_required'; message: string; ssoUrl?: string }
  | { type: 'host_unreachable'; message: string }
  | { type: 'unsupported_host'; message: string }
  | { type: 'invalid_input'; message: string }
  | { type: 'generic'; message: string };

export type IssueListResult = Result<IssueData[], IssueError>;

export type IssueGetResult = Result<IssueDetail, IssueError>;
