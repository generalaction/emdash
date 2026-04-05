import type { GitPlatform } from '../../shared/git/platform';

/**
 * GitPlatformService — CLI Command Builder & Response Parser
 *
 * Maps platform-agnostic PR/MR operations to the right CLI commands
 * (`gh` for GitHub, `glab` for GitLab) and normalizes their responses
 * into a common shape.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlatformConfig {
  cli: string;
  noun: string;
  nounFull: string;
}

export interface CreateOpts {
  title?: string;
  base?: string;
  head?: string;
  body?: string;
  bodyFile?: string;
  draft?: boolean;
  web?: boolean;
  fill?: boolean;
}

export interface MergeOpts {
  prNumber?: number;
  strategy?: 'merge' | 'squash' | 'rebase';
  admin?: boolean;
}

export interface ListOpts {
  limit?: number;
  searchQuery?: string;
}

export interface NormalizedPrStatus {
  number: number;
  url: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  mergeStateStatus: string | null;
  headRefName: string;
  baseRefName: string;
  title: string;
  author: { login: string } | null;
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
  autoMergeRequest: { enabledBy: Record<string, unknown> } | null;
  updatedAt: string | null;
}

export interface NormalizedPrListItem {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  url: string;
  isDraft: boolean;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  updatedAt: string | null;
  author: { login: string } | null;
  checksStatus?: 'pass' | 'fail' | 'pending' | 'none' | null;
}

// ---------------------------------------------------------------------------
// Platform Config
// ---------------------------------------------------------------------------

const CONFIGS: Record<GitPlatform, PlatformConfig> = {
  github: { cli: 'gh', noun: 'pr', nounFull: 'pull request' },
  gitlab: { cli: 'glab', noun: 'mr', nounFull: 'merge request' },
};

export function getPlatformConfig(platform: GitPlatform): PlatformConfig {
  return CONFIGS[platform];
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Fields requested from `gh pr view` / `gh pr list` */
const GH_STATUS_FIELDS = [
  'number',
  'url',
  'state',
  'isDraft',
  'mergeStateStatus',
  'headRefName',
  'baseRefName',
  'title',
  'author',
  'additions',
  'deletions',
  'changedFiles',
  'autoMergeRequest',
  'updatedAt',
];

function strategyFlag(strategy?: string): string {
  switch (strategy) {
    case 'squash':
      return '--squash';
    case 'rebase':
      return '--rebase';
    default:
      return '--merge';
  }
}

function gitLabStrategyFlag(strategy?: string): string | null {
  switch (strategy) {
    case 'squash':
      return '--squash';
    case 'rebase':
      return '--rebase';
    default:
      return null;
  }
}

function quoteArg(value: string): string {
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Command Builders
// ---------------------------------------------------------------------------

export function buildCreateCommand(platform: GitPlatform, opts: CreateOpts): string {
  const { cli, noun } = getPlatformConfig(platform);
  const parts: string[] = [`${cli} ${noun} create`];

  if (opts.title) parts.push(`--title ${quoteArg(opts.title)}`);

  if (platform === 'github') {
    if (opts.bodyFile) {
      parts.push(`--body-file ${quoteArg(opts.bodyFile)}`);
    } else if (opts.body) {
      parts.push(`--body ${quoteArg(opts.body)}`);
    }
    if (opts.base) parts.push(`--base ${quoteArg(opts.base)}`);
    if (opts.head) parts.push(`--head ${quoteArg(opts.head)}`);
  } else {
    // gitlab — glab does not support @file; read via command substitution to preserve newlines
    if (opts.bodyFile) {
      const escaped = opts.bodyFile.replace(/'/g, "'\\''");
      parts.push(`--description "$(cat '${escaped}')"`);
    } else if (opts.body) {
      parts.push(`--description ${quoteArg(opts.body)}`);
    }
    if (opts.base) parts.push(`--target-branch ${quoteArg(opts.base)}`);
    if (opts.head) parts.push(`--source-branch ${quoteArg(opts.head)}`);
  }

  if (opts.draft) parts.push('--draft');
  if (opts.web) parts.push('--web');
  if (opts.fill) parts.push('--fill');

  // GitLab needs --yes for non-interactive mode
  if (platform === 'gitlab') parts.push('--yes');

  return parts.join(' ');
}

export function buildStatusCommand(platform: GitPlatform, prNumber?: number): string | null {
  const { cli, noun } = getPlatformConfig(platform);
  const numPart = typeof prNumber === 'number' ? ` ${prNumber}` : '';

  if (platform === 'github') {
    return `${cli} ${noun} view${numPart} --json ${GH_STATUS_FIELDS.join(',')} -q .`;
  }
  if (typeof prNumber === 'number') {
    return `${cli} api "projects/:id/merge_requests/${prNumber}"`;
  }
  // Without a number, caller falls back to list-by-branch (avoids glab interactive prompts)
  return null;
}

export function buildStatusListFallbackCommand(platform: GitPlatform, branchName: string): string {
  const { cli, noun } = getPlatformConfig(platform);

  if (platform === 'github') {
    return `${cli} ${noun} list --head ${quoteArg(branchName)} --json ${GH_STATUS_FIELDS.join(',')} --limit 1`;
  }
  return `${cli} api "projects/:id/merge_requests?scope=all&state=opened&source_branch=${encodeURIComponent(branchName)}&order_by=updated_at&sort=desc&per_page=1"`;
}

export function buildMergeCommand(platform: GitPlatform, opts: MergeOpts): string {
  const { cli, noun } = getPlatformConfig(platform);
  const parts: string[] = [`${cli} ${noun} merge`];

  if (typeof opts.prNumber === 'number' && Number.isFinite(opts.prNumber)) {
    parts.push(String(opts.prNumber));
  }

  const mergeFlag =
    platform === 'gitlab' ? gitLabStrategyFlag(opts.strategy) : strategyFlag(opts.strategy);
  if (mergeFlag) parts.push(mergeFlag);

  if (platform === 'github' && opts.admin) {
    parts.push('--admin');
  }

  // GitLab needs --yes for non-interactive mode
  if (platform === 'gitlab') parts.push('--yes');

  return parts.join(' ');
}

export function buildAutoMergeCommand(
  platform: GitPlatform,
  opts: { prNumber?: number; strategy?: string }
): string {
  const { cli, noun } = getPlatformConfig(platform);
  const parts: string[] = [`${cli} ${noun} merge`];

  if (typeof opts.prNumber === 'number' && Number.isFinite(opts.prNumber)) {
    parts.push(String(opts.prNumber));
  }

  if (platform === 'github') {
    parts.push('--auto');
  } else {
    parts.push('--auto-merge');
  }

  const mergeFlag =
    platform === 'gitlab' ? gitLabStrategyFlag(opts.strategy) : strategyFlag(opts.strategy);
  if (mergeFlag) parts.push(mergeFlag);

  if (platform === 'gitlab') parts.push('--yes');

  return parts.join(' ');
}

export function buildDisableAutoMergeCommand(
  platform: GitPlatform,
  prNumber?: number
): string | null {
  if (platform === 'gitlab') return null;

  const parts: string[] = ['gh pr merge'];
  if (typeof prNumber === 'number' && Number.isFinite(prNumber)) {
    parts.push(String(prNumber));
  }
  parts.push('--disable-auto');
  return parts.join(' ');
}

export function buildListCommand(platform: GitPlatform, opts: ListOpts): string {
  const { cli, noun } = getPlatformConfig(platform);
  const limit = opts.limit ?? 30;

  if (platform === 'github') {
    const parts: string[] = [
      `${cli} ${noun} list`,
      '--state open',
      `--json ${GH_STATUS_FIELDS.join(',')}`,
      `--limit ${limit}`,
    ];
    if (opts.searchQuery) {
      parts.push(`--search ${quoteArg(opts.searchQuery)}`);
    }
    return parts.join(' ');
  }

  // glab api avoids the interactive "which base repository" prompt and includes head_pipeline
  const params: string[] = [
    `scope=all`,
    `state=opened`,
    `order_by=updated_at`,
    `sort=desc`,
    `per_page=${limit}`,
  ];
  if (opts.searchQuery) {
    const query = opts.searchQuery;
    if (query.includes('assignee:@me')) {
      params[0] = 'scope=assigned_to_me';
    }
    if (query.includes('reviewer:@me')) {
      params[0] = 'scope=reviews_for_me';
    }
    if (query.includes('draft:true')) {
      params.push('wip=yes');
    }
    if (query.includes('not-draft')) {
      params.push('wip=no');
    }
    const freeText = query
      .replace(/assignee:@me/g, '')
      .replace(/reviewer:@me/g, '')
      .replace(/draft:true/g, '')
      .replace(/not-draft/g, '')
      .trim();
    if (freeText) {
      params.push(`search=${encodeURIComponent(freeText)}`);
    }
  }
  return `${cli} api "projects/:id/merge_requests?${params.join('&')}"`;
}

// ---------------------------------------------------------------------------
// Response Parsers
// ---------------------------------------------------------------------------

function normalizeGitLabState(state?: string): 'OPEN' | 'CLOSED' | 'MERGED' {
  switch (state) {
    case 'opened':
      return 'OPEN';
    case 'closed':
      return 'CLOSED';
    case 'merged':
      return 'MERGED';
    default:
      return 'OPEN';
  }
}

function normalizeGitLabMergeStatus(
  mergeStatus?: string,
  hasConflicts?: boolean,
  detailedStatus?: string
): string | null {
  // Prefer detailed_merge_status (available in newer GitLab APIs)
  if (detailedStatus) {
    switch (detailedStatus) {
      case 'mergeable':
      case 'ci_must_pass':
      case 'ci_still_running':
        return 'CLEAN';
      case 'not_open':
      case 'draft_status':
        return 'BLOCKED';
      case 'broken_status':
      case 'conflict':
        return 'CONFLICTING';
      case 'need_rebase':
        return 'BEHIND';
      case 'blocked_status':
      case 'not_approved':
      case 'discussions_not_resolved':
      case 'approvals_syncing':
        return 'BLOCKED';
      case 'checking':
      case 'unchecked':
        // Still computing — treat as clean to avoid false "unknown"
        return 'CLEAN';
    }
  }
  if (!mergeStatus) return null;
  if (mergeStatus === 'can_be_merged' && !hasConflicts) return 'CLEAN';
  if (mergeStatus === 'cannot_be_merged' || hasConflicts) return 'CONFLICTING';
  // Treat recheck states as pending/clean rather than unknown
  if (mergeStatus.includes('recheck')) return 'CLEAN';
  return mergeStatus.toUpperCase();
}

function parseGitLabStatus(data: Record<string, unknown>): NormalizedPrStatus {
  const changesCount =
    typeof data.changes_count === 'string' ? parseInt(data.changes_count, 10) : null;

  const author = data.author as Record<string, unknown> | null | undefined;
  const authorLogin = author?.username as string | undefined;

  const mergeWhenPipeline = data.merge_when_pipeline_succeeds as boolean | undefined;

  return {
    number: (data.iid as number) ?? 0,
    url: (data.web_url as string) ?? '',
    state: normalizeGitLabState(data.state as string | undefined),
    isDraft: !!(data.draft || data.work_in_progress),
    mergeStateStatus: normalizeGitLabMergeStatus(
      data.merge_status as string | undefined,
      data.has_conflicts as boolean | undefined,
      data.detailed_merge_status as string | undefined
    ),
    headRefName: (data.source_branch as string) ?? '',
    baseRefName: (data.target_branch as string) ?? '',
    title: (data.title as string) ?? '',
    author: authorLogin ? { login: authorLogin } : null,
    additions: typeof data.additions === 'number' ? data.additions : null,
    deletions: typeof data.deletions === 'number' ? data.deletions : null,
    changedFiles: Number.isFinite(changesCount) ? changesCount : null,
    autoMergeRequest: mergeWhenPipeline ? { enabledBy: {} } : null,
    updatedAt: (data.updated_at as string) ?? null,
  };
}

function parseGitHubStatus(data: Record<string, unknown>): NormalizedPrStatus {
  const author = data.author as Record<string, unknown> | null | undefined;
  return {
    number: (data.number as number) ?? 0,
    url: (data.url as string) ?? '',
    state: (data.state as 'OPEN' | 'CLOSED' | 'MERGED') ?? 'OPEN',
    isDraft: !!(data.isDraft as boolean | undefined),
    mergeStateStatus: (data.mergeStateStatus as string) ?? null,
    headRefName: (data.headRefName as string) ?? '',
    baseRefName: (data.baseRefName as string) ?? '',
    title: (data.title as string) ?? '',
    author: author ? { login: (author.login as string) ?? '' } : null,
    additions: typeof data.additions === 'number' ? data.additions : null,
    deletions: typeof data.deletions === 'number' ? data.deletions : null,
    changedFiles: typeof data.changedFiles === 'number' ? data.changedFiles : null,
    autoMergeRequest: data.autoMergeRequest
      ? (data.autoMergeRequest as { enabledBy: Record<string, unknown> })
      : null,
    updatedAt: (data.updatedAt as string) ?? null,
  };
}

export function parseStatusResponse(platform: GitPlatform, raw: string): NormalizedPrStatus | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (typeof data !== 'object' || data === null) return null;

  return platform === 'gitlab' ? parseGitLabStatus(data) : parseGitHubStatus(data);
}

function deriveGitLabChecksStatus(
  pipeline: Record<string, unknown> | null | undefined
): 'pass' | 'fail' | 'pending' | 'none' {
  if (!pipeline || typeof pipeline !== 'object') return 'none';
  const status = pipeline.status as string | undefined;
  if (!status) return 'none';
  if (status === 'success') return 'pass';
  if (status === 'failed') return 'fail';
  // running, pending, created, waiting_for_resource, manual
  return 'pending';
}

function parseGitLabListItem(item: Record<string, unknown>): NormalizedPrListItem {
  const author = item.author as Record<string, unknown> | null | undefined;
  const authorLogin = author?.username as string | undefined;
  const headPipeline = item.head_pipeline as Record<string, unknown> | null | undefined;

  return {
    number: (item.iid as number) ?? 0,
    title: (item.title as string) ?? '',
    headRefName: (item.source_branch as string) ?? '',
    baseRefName: (item.target_branch as string) ?? '',
    url: (item.web_url as string) ?? '',
    isDraft: !!(item.draft || item.work_in_progress),
    state: normalizeGitLabState(item.state as string | undefined),
    updatedAt: (item.updated_at as string) ?? null,
    author: authorLogin ? { login: authorLogin } : null,
    checksStatus: deriveGitLabChecksStatus(headPipeline),
  };
}

function parseGitHubListItem(item: Record<string, unknown>): NormalizedPrListItem {
  const author = item.author as Record<string, unknown> | null | undefined;
  return {
    number: (item.number as number) ?? 0,
    title: (item.title as string) ?? '',
    headRefName: (item.headRefName as string) ?? '',
    baseRefName: (item.baseRefName as string) ?? '',
    url: (item.url as string) ?? '',
    isDraft: !!(item.isDraft as boolean | undefined),
    state: (item.state as 'OPEN' | 'CLOSED' | 'MERGED') ?? 'OPEN',
    updatedAt: (item.updatedAt as string) ?? null,
    author: author ? { login: (author.login as string) ?? '' } : null,
  };
}

export function parseListResponse(platform: GitPlatform, raw: string): NormalizedPrListItem[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return [];
  }

  if (!Array.isArray(data)) return [];

  return platform === 'gitlab'
    ? data.map((item) => parseGitLabListItem(item as Record<string, unknown>))
    : data.map((item) => parseGitHubListItem(item as Record<string, unknown>));
}

// ---------------------------------------------------------------------------
// Error Pattern Helpers
// ---------------------------------------------------------------------------

export function isPrAlreadyExistsError(platform: GitPlatform, errorText: string): boolean {
  const pattern =
    platform === 'github'
      ? /already exists|already has|pull request for branch/i
      : /already exists|merge request already exists/i;
  return pattern.test(errorText);
}

export function isCliNotInstalledError(errorText: string): boolean {
  return /not installed|command not found/i.test(errorText);
}

export function isPrNotFoundError(platform: GitPlatform, errorText: string): boolean {
  const pattern = platform === 'github' ? /no pull requests? found|not found/i : /not found|404/i;
  return pattern.test(errorText);
}

export function extractUrlFromOutput(platform: GitPlatform, output: string): string | null {
  if (platform === 'gitlab') {
    const match = output.match(/https?:\/\/\S*merge_requests\/\d+/);
    return match ? match[0] : null;
  }
  // github
  const match = output.match(/https?:\/\/\S+/);
  return match ? match[0] : null;
}
