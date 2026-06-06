import type { Octokit } from '@octokit/rest';
import type { IssueListError } from '@shared/issue-providers';
import type { RepositoryRef } from '@shared/repository-ref';
import { err, ok, type Result } from '@shared/result';
import type { GitHubApiAuthError } from './github-api-auth-errors';
import type { GitHubApiAuthContext } from './github-api-auth-service';
import { classifyGitHubApiError, type GitHubApiOperationError } from './github-api-errors';
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
      return err(this.mapApiError(error, 'Unable to list GitHub issues', repository));
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
      return err(this.mapApiError(error, 'Unable to search GitHub issues', repository));
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
      return err(this.mapApiError(error, 'Unable to get GitHub issue', repository));
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
    switch (error.type) {
      case 'auth_required':
        return { type: 'auth_required', host: error.host, message: error.message };
      case 'account_not_found':
        return {
          type: 'account_not_found',
          host: error.host,
          accountId: error.accountId,
          message: error.message,
        };
      case 'account_host_mismatch':
        return {
          type: 'account_host_mismatch',
          host: error.host,
          accountId: error.accountId,
          accountHost: error.accountHost,
          message: error.message,
        };
      case 'token_missing':
        return {
          type: 'token_missing',
          host: error.host,
          accountId: error.accountId,
          message: error.message,
        };
    }
  }

  private mapApiError(error: unknown, fallback: string, repository: RepositoryRef): IssueListError {
    return this.mapOperationError(
      classifyGitHubApiError(error, {
        host: repository.host,
        nameWithOwner: repository.nameWithOwner,
        fallback,
      })
    );
  }

  private mapOperationError(error: GitHubApiOperationError): IssueListError {
    switch (error.type) {
      case 'auth_required':
        return { type: 'auth_required', host: error.host, message: error.message };
      case 'not_found_or_no_access':
        return { type: 'not_found_or_no_access', host: error.host, message: error.message };
      case 'sso_required':
        return {
          type: 'sso_required',
          host: error.host,
          message: error.message,
          ...(error.ssoUrl ? { ssoUrl: error.ssoUrl } : {}),
        };
      case 'rate_limited':
        return {
          type: 'rate_limited',
          host: error.host,
          message: error.message,
          ...(error.resetAt ? { resetAt: error.resetAt } : {}),
        };
      case 'forbidden':
        return { type: 'forbidden', host: error.host, message: error.message };
      case 'host_unreachable':
        return { type: 'host_unreachable', host: error.host, message: error.reason };
      case 'api_error':
        return { type: 'generic', message: error.message };
    }
  }
}

export const issueService = new GitHubIssueServiceImpl(getOctokit);
