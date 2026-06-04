import type { Octokit } from '@octokit/rest';
import type { IssueListError } from '@shared/issue-providers';
import { isGitHubDotComHost, type RepositoryRef } from '@shared/repository-ref';
import { err, ok, type Result } from '@shared/result';
import type { GitHubApiAuthError } from './github-api-auth-errors';
import type { GitHubApiAuthContext } from './github-api-auth-service';
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
  body: string | null;
  user: { login: string; avatarUrl: string } | null;
  assignees: Array<{ login: string; avatarUrl: string }>;
  labels: Array<{ name: string; color: string }>;
}

export type GitHubIssueDetail = GitHubIssue;

export interface GitHubIssueService {
  listIssues(
    repository: RepositoryRef,
    limit?: number,
    authContext?: GitHubApiAuthContext
  ): Promise<Result<GitHubIssue[], IssueListError>>;
  searchIssues(
    repository: RepositoryRef,
    searchTerm: string,
    limit?: number,
    authContext?: GitHubApiAuthContext
  ): Promise<Result<GitHubIssue[], IssueListError>>;
  getIssue(
    repository: RepositoryRef,
    issueNumber: number,
    authContext?: GitHubApiAuthContext
  ): Promise<Result<GitHubIssueDetail | null, IssueListError>>;
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
  constructor(
    private readonly getOctokit: (
      host: string,
      context?: GitHubApiAuthContext
    ) => Promise<Result<Octokit, GitHubApiAuthError>>
  ) {}

  async listIssues(
    repository: RepositoryRef,
    limit: number = 50,
    authContext: GitHubApiAuthContext = {}
  ): Promise<Result<GitHubIssue[], IssueListError>> {
    const { owner, repo, host } = repository;
    const octokit = await this.getOctokit(host, authContext);
    if (!octokit.success) return err(this.mapAuthError(octokit.error));

    try {
      const { data } = await octokit.data.rest.issues.listForRepo({
        owner,
        repo,
        state: 'open',
        per_page: Math.min(Math.max(limit, 1), 100),
        sort: 'updated',
        direction: 'desc',
      });
      return ok(
        data
          .filter((issue) => !issue.pull_request)
          .map((item) => this.mapIssue(item as unknown as RestIssue))
      );
    } catch (error) {
      return err(this.mapApiError(error, 'Unable to list GitHub issues', host));
    }
  }

  async searchIssues(
    repository: RepositoryRef,
    searchTerm: string,
    limit: number = 20,
    authContext: GitHubApiAuthContext = {}
  ): Promise<Result<GitHubIssue[], IssueListError>> {
    const term = searchTerm.trim();
    if (!term) return ok([]);
    const { owner, repo, host } = repository;
    const octokit = await this.getOctokit(host, authContext);
    if (!octokit.success) return err(this.mapAuthError(octokit.error));

    try {
      const { data } = await octokit.data.rest.search.issuesAndPullRequests({
        q: `${term} repo:${owner}/${repo} is:issue is:open`,
        per_page: Math.min(Math.max(limit, 1), 100),
        sort: 'updated',
        order: 'desc',
      });
      return ok(data.items.map((item) => this.mapIssue(item as unknown as RestIssue)));
    } catch (error) {
      return err(this.mapApiError(error, 'Unable to search GitHub issues', host));
    }
  }

  async getIssue(
    repository: RepositoryRef,
    issueNumber: number,
    authContext: GitHubApiAuthContext = {}
  ): Promise<Result<GitHubIssueDetail | null, IssueListError>> {
    const { owner, repo, host } = repository;
    const octokit = await this.getOctokit(host, authContext);
    if (!octokit.success) return err(this.mapAuthError(octokit.error));

    try {
      const { data } = await octokit.data.rest.issues.get({
        owner,
        repo,
        issue_number: issueNumber,
      });
      return ok(this.mapIssue(data as unknown as RestIssue));
    } catch (error) {
      return err(this.mapApiError(error, 'Unable to get GitHub issue', host));
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
      body: item.body ?? null,
      user: item.user ? { login: item.user.login, avatarUrl: item.user.avatar_url } : null,
      assignees: (item.assignees ?? []).map((a) => ({ login: a.login, avatarUrl: a.avatar_url })),
      labels: (item.labels ?? []).map((l) =>
        typeof l === 'string'
          ? { name: l, color: '' }
          : { name: l.name ?? '', color: l.color ?? '' }
      ),
    };
  }

  private mapAuthError(error: GitHubApiAuthError): IssueListError {
    return { type: 'auth_required', host: error.host, message: error.message };
  }

  private mapApiError(error: unknown, fallback: string, host: string): IssueListError {
    if (error && typeof error === 'object' && 'status' in error) {
      const status = Number((error as { status: unknown }).status);
      if (status === 401 || status === 403) {
        const hint = isGitHubDotComHost(host)
          ? 'Connect GitHub from account settings.'
          : `Run: gh auth login --hostname ${host}`;
        return {
          type: 'auth_required',
          host,
          message: isGitHubDotComHost(host)
            ? `GitHub authentication required. ${hint}`
            : `GitHub Enterprise authentication required for ${host}. ${hint}`,
        };
      }
    }

    return {
      type: 'generic',
      message: error instanceof Error ? error.message : fallback,
    };
  }
}

export const issueService = new GitHubIssueServiceImpl(getOctokit);
