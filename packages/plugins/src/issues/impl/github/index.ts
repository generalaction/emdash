import { err, ok } from '@emdash/shared';
import { resolveRepositoryRemote } from '../../../integrations/helpers/git-remote';
import {
  createGitHubClient,
  readGitHubCredentials,
} from '../../../integrations/impl/github/client';
import { clampIssueLimit, issueError, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type { IssueData, IssueError } from '../../types';

type GitHubRestIssue = {
  number: number;
  title: string;
  html_url: string;
  state: string;
  updated_at: string | null;
  assignees?: Array<{ login: string } | null> | null;
  body?: string | null;
  pull_request?: unknown;
};

function toIssue(raw: GitHubRestIssue): IssueData {
  return {
    identifier: `#${raw.number}`,
    title: raw.title,
    url: raw.html_url,
    description: raw.body ?? undefined,
    status: raw.state,
    assignees: (raw.assignees ?? []).map((assignee) => assignee?.login ?? '').filter(Boolean),
    updatedAt: raw.updated_at ?? undefined,
  };
}

type OctokitRequestErrorLike = Error & {
  status: number;
  response?: { headers?: Record<string, unknown> };
};

function isOctokitRequestError(error: unknown): error is OctokitRequestErrorLike {
  return error instanceof Error && typeof (error as { status?: unknown }).status === 'number';
}

function mapRequestError(error: OctokitRequestErrorLike): IssueError {
  const message = error.message || 'GitHub API request failed.';
  const headers = error.response?.headers ?? {};

  if (error.status === 401) return issueError('auth_failed', message);
  if (error.status === 403) {
    const sso = headers['x-github-sso'];
    if (typeof sso === 'string' && sso) {
      const url = /url=([^;]+)/.exec(sso)?.[1];
      return { type: 'sso_required', message, ...(url ? { ssoUrl: url } : {}) };
    }
    const reset = headers['x-ratelimit-reset'];
    if (reset !== undefined && reset !== null) {
      const resetAt =
        reset && String(reset) !== '0' ? new Date(Number(reset) * 1000).toISOString() : undefined;
      return { type: 'rate_limited', message, ...(resetAt ? { resetAt } : {}) };
    }
    return issueError('auth_failed', message);
  }
  if (error.status === 404) return issueError('not_found_or_no_access', message);
  if (error.status === 429) return issueError('rate_limited', message);
  if (error.status >= 500) return issueError('host_unreachable', message);
  return issueError('generic', message);
}

function toIssueError(error: unknown, fallback: string): IssueError {
  if (isOctokitRequestError(error)) return mapRequestError(error);
  if (error && typeof error === 'object' && 'type' in error && 'message' in error) {
    return error as IssueError;
  }
  if (error instanceof Error) return issueError('generic', error.message);
  return issueError('generic', fallback);
}

const plugin = defineIssuesPlugin(
  { integrationId: 'github' },
  { issues: { requiredInputs: ['repositoryUrl'] } },
  {}
);

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: {
    async listIssues(host, opts) {
      try {
        const octokit = createGitHubClient(readGitHubCredentials(host.credentials));
        const repository = resolveRepositoryRemote(opts.repositoryUrl);
        const [owner, ...repoParts] = repository.slug.split('/');
        const repo = repoParts.join('/');
        const limit = clampIssueLimit(opts.limit, 50, 100);
        const { data } = await octokit.rest.issues.listForRepo({
          owner,
          repo,
          state: 'open',
          per_page: limit,
          sort: 'updated',
          direction: 'desc',
        });
        return ok(data.filter((issue) => !issue.pull_request).map(toIssue));
      } catch (error) {
        return err(toIssueError(error, 'Unable to list GitHub issues.'));
      }
    },

    async searchIssues(host, opts) {
      const term = normalizeSearchTerm(opts.searchTerm);
      if (!term) return ok([]);

      try {
        const octokit = createGitHubClient(readGitHubCredentials(host.credentials));
        const repository = resolveRepositoryRemote(opts.repositoryUrl);
        const limit = clampIssueLimit(opts.limit, 20, 100);
        const { data } = await octokit.rest.search.issuesAndPullRequests({
          q: `${term} repo:${repository.slug} is:issue is:open`,
          per_page: limit,
          sort: 'updated',
          order: 'desc',
        });
        return ok(data.items.map(toIssue));
      } catch (error) {
        return err(toIssueError(error, 'Unable to search GitHub issues.'));
      }
    },
  },
});
