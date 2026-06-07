import { normalizeSearchTerm } from '@main/core/issues/helpers/provider-inputs';
import type { IssueProvider } from '@main/core/issues/issue-provider';
import type { LinkedIssue } from '@shared/core/linked-issue';
import {
  ISSUE_PROVIDER_CAPABILITIES,
  type IssueListError,
  type IssueListResult,
} from '@shared/issue-providers';
import { err, ok, type Result } from '@shared/lib/result';
import type { RepositoryRef } from '@shared/repository-ref';
import { githubConnectionService } from './services/github-connection-service';
import { githubRepositoryResolver } from './services/github-repository-resolver';
import { issueService } from './services/issue-service';

function toIssue(raw: {
  number: number;
  title: string;
  url: string;
  state: string;
  updatedAt: string | null;
  assignees: Array<{ login: string }>;
  body?: string | null;
}): LinkedIssue {
  return {
    provider: 'github',
    identifier: `#${raw.number}`,
    title: raw.title,
    url: raw.url,
    description: raw.body ?? undefined,
    status: raw.state,
    assignees: raw.assignees.map((assignee) => assignee.login).filter(Boolean),
    updatedAt: raw.updatedAt ?? undefined,
    fetchedAt: new Date().toISOString(),
  };
}

function toIssueListResult(result: Result<LinkedIssue[], IssueListError>): IssueListResult {
  if (result.success) return { success: true, issues: result.data };
  return {
    success: false,
    error: result.error.message,
    errorType: result.error.type,
    host: 'host' in result.error ? result.error.host : undefined,
  };
}

async function listIssues(
  repository: RepositoryRef,
  limit: number
): Promise<Result<LinkedIssue[], IssueListError>> {
  const issues = await issueService.listIssues(repository, limit);
  if (!issues.success) return err(issues.error);
  return ok(issues.data.map(toIssue));
}

async function searchIssues(
  repository: RepositoryRef,
  searchTerm: string,
  limit: number
): Promise<Result<LinkedIssue[], IssueListError>> {
  if (!normalizeSearchTerm(searchTerm)) {
    return ok([]);
  }

  const issues = await issueService.searchIssues(repository, searchTerm, limit);
  if (!issues.success) return err(issues.error);
  return ok(issues.data.map(toIssue));
}

async function resolveRepository(opts: {
  repositoryUrl?: string;
  remote?: string;
}): Promise<Result<RepositoryRef, IssueListError>> {
  const resolved = await githubRepositoryResolver.resolve(opts.repositoryUrl || opts.remote);
  if (resolved.success) return ok(resolved.data);

  switch (resolved.error.type) {
    case 'not_parseable':
      return err({ type: 'generic', message: 'Repository URL is required.' });
    case 'not_github':
      return err({
        type: 'unsupported_host',
        host: resolved.error.host,
        message: 'This remote does not appear to be GitHub or GitHub Enterprise.',
      });
    case 'host_unreachable':
    case 'host_error':
      return err({
        type: 'host_unreachable',
        host: resolved.error.host,
        message: resolved.error.reason,
      });
  }
}

export const githubIssueProvider: IssueProvider = {
  type: 'github',
  capabilities: ISSUE_PROVIDER_CAPABILITIES.github,

  checkConnection: async () => {
    const status = await githubConnectionService.getStatus();
    return {
      connected: status.authenticated,
      displayName: status.user?.login || status.user?.name || undefined,
      capabilities: ISSUE_PROVIDER_CAPABILITIES.github,
    };
  },

  listIssues: async (opts) => {
    const repository = await resolveRepository(opts);
    if (!repository.success) return toIssueListResult(repository);

    return toIssueListResult(await listIssues(repository.data, opts.limit ?? 50));
  },

  searchIssues: async (opts) => {
    const repository = await resolveRepository(opts);
    if (!repository.success) return toIssueListResult(repository);

    return toIssueListResult(
      await searchIssues(repository.data, opts.searchTerm, opts.limit ?? 20)
    );
  },
};
