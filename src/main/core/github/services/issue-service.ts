import type { Octokit } from '@octokit/rest';
import type { GitHubRepositoryRef } from '@shared/github-repository';
import { getOctokit } from './octokit-provider';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitHubIssue {
  number: number;
  title: string;
  url: string;
  state: string;
  createdAt: string | null;
  updatedAt: string | null;
  comments: number;
  user: { login: string; avatarUrl: string } | null;
  assignees: Array<{ login: string; avatarUrl: string }>;
  labels: Array<{ name: string; color: string }>;
}

export interface GitHubIssueDetail extends GitHubIssue {
  body: string | null;
}

export interface ListIssuesForPollingOptions {
  limit?: number;
  /** ISO timestamp passed as `since` to filter issues updated after this time. */
  since?: string;
  /** Previous ETag from a prior poll; sent as `If-None-Match`. */
  etag?: string;
}

export interface PollIssuesResult {
  /** False when the request itself failed (network/auth/etc). 304 still counts as ok. */
  ok: boolean;
  issues: GitHubIssue[];
  etag?: string;
  /** True when GitHub returned 304 — caller can skip processing. */
  notModified: boolean;
}

export interface GitHubIssueService {
  listIssues(repository: GitHubRepositoryRef, limit?: number): Promise<GitHubIssue[]>;
  searchIssues(
    repository: GitHubRepositoryRef,
    searchTerm: string,
    limit?: number
  ): Promise<GitHubIssue[]>;
  getIssue(repository: GitHubRepositoryRef, issueNumber: number): Promise<GitHubIssueDetail | null>;
  listIssuesForPolling(
    repository: GitHubRepositoryRef,
    options: ListIssuesForPollingOptions
  ): Promise<PollIssuesResult>;
}

// ---------------------------------------------------------------------------
// REST response shape (internal)
// ---------------------------------------------------------------------------

interface RestIssue {
  number: number;
  title: string;
  html_url: string;
  state: string;
  created_at: string | null;
  updated_at: string | null;
  comments: number;
  user: { login: string; avatar_url: string } | null;
  assignees: Array<{ login: string; avatar_url: string }> | null;
  labels: Array<string | { name?: string; color?: string }>;
  body?: string | null;
  pull_request?: unknown;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class GitHubIssueServiceImpl implements GitHubIssueService {
  constructor(private readonly getOctokit: () => Promise<Octokit>) {}

  async listIssues(repository: GitHubRepositoryRef, limit: number = 50): Promise<GitHubIssue[]> {
    const { owner, repo } = repository;
    try {
      const octokit = await this.getOctokit();
      const { data } = await octokit.rest.issues.listForRepo({
        owner,
        repo,
        state: 'open',
        per_page: Math.min(Math.max(limit, 1), 100),
        sort: 'updated',
        direction: 'desc',
      });
      return data
        .filter((issue) => !issue.pull_request)
        .map((item) => this.mapIssue(item as unknown as RestIssue));
    } catch {
      return [];
    }
  }

  async listIssuesForPolling(
    repository: GitHubRepositoryRef,
    options: ListIssuesForPollingOptions
  ): Promise<PollIssuesResult> {
    const { owner, repo } = repository;
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    try {
      const octokit = await this.getOctokit();
      const response = await octokit.rest.issues.listForRepo({
        owner,
        repo,
        state: 'open',
        per_page: limit,
        sort: 'updated',
        direction: 'desc',
        ...(options.since ? { since: options.since } : {}),
        ...(options.etag ? { headers: { 'if-none-match': options.etag } } : {}),
      });
      const headers = (response.headers ?? {}) as { etag?: string };
      const issues = response.data
        .filter((issue) => !issue.pull_request)
        .map((item) => this.mapIssue(item as unknown as RestIssue));
      return { ok: true, issues, etag: headers.etag, notModified: false };
    } catch (error) {
      const status = (error as { status?: number } | null)?.status;
      if (status === 304) {
        return { ok: true, issues: [], etag: options.etag, notModified: true };
      }
      return { ok: false, issues: [], notModified: false };
    }
  }

  async searchIssues(
    repository: GitHubRepositoryRef,
    searchTerm: string,
    limit: number = 20
  ): Promise<GitHubIssue[]> {
    const term = searchTerm.trim();
    if (!term) return [];
    const { owner, repo } = repository;
    try {
      const octokit = await this.getOctokit();
      const { data } = await octokit.rest.search.issuesAndPullRequests({
        q: `${term} repo:${owner}/${repo} is:issue is:open`,
        per_page: Math.min(Math.max(limit, 1), 100),
        sort: 'updated',
        order: 'desc',
      });
      return data.items.map((item) => this.mapIssue(item as unknown as RestIssue));
    } catch {
      return [];
    }
  }

  async getIssue(
    repository: GitHubRepositoryRef,
    issueNumber: number
  ): Promise<GitHubIssueDetail | null> {
    const { owner, repo } = repository;
    try {
      const octokit = await this.getOctokit();
      const { data } = await octokit.rest.issues.get({
        owner,
        repo,
        issue_number: issueNumber,
      });
      return this.mapIssueDetail(data as unknown as RestIssue);
    } catch {
      return null;
    }
  }

  private mapIssue(item: RestIssue): GitHubIssue {
    return {
      number: item.number,
      title: item.title,
      url: item.html_url,
      state: item.state,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      comments: item.comments,
      user: item.user ? { login: item.user.login, avatarUrl: item.user.avatar_url } : null,
      assignees: (item.assignees ?? []).map((a) => ({ login: a.login, avatarUrl: a.avatar_url })),
      labels: (item.labels ?? []).map((l) =>
        typeof l === 'string'
          ? { name: l, color: '' }
          : { name: l.name ?? '', color: l.color ?? '' }
      ),
    };
  }

  private mapIssueDetail(item: RestIssue): GitHubIssueDetail {
    return {
      ...this.mapIssue(item),
      body: item.body ?? null,
    };
  }
}

export const issueService = new GitHubIssueServiceImpl(getOctokit);
