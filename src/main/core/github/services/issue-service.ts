import type { Octokit } from '@octokit/rest';
import { getOctokit } from './octokit-provider';
import { splitRepo } from './utils';

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

export interface GitHubIssueService {
  listIssues(nameWithOwner: string, limit?: number): Promise<GitHubIssue[]>;
  searchIssues(nameWithOwner: string, searchTerm: string, limit?: number): Promise<GitHubIssue[]>;
  getIssue(nameWithOwner: string, issueNumber: number): Promise<GitHubIssueDetail | null>;
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

  async listIssues(nameWithOwner: string, limit: number = 50): Promise<GitHubIssue[]> {
    const { owner, repo } = splitRepo(nameWithOwner);
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

  async searchIssues(
    nameWithOwner: string,
    searchTerm: string,
    limit: number = 20
  ): Promise<GitHubIssue[]> {
    const term = searchTerm.trim();
    if (!term) return [];
    const { owner, repo } = splitRepo(nameWithOwner);
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

  async getIssue(nameWithOwner: string, issueNumber: number): Promise<GitHubIssueDetail | null> {
    const { owner, repo } = splitRepo(nameWithOwner);
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
