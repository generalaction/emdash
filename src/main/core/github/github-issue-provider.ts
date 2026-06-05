import { normalizeSearchTerm } from '@main/core/issues/helpers/provider-inputs';
import type { IssueProvider } from '@main/core/issues/issue-provider';
import {
  ISSUE_PROVIDER_CAPABILITIES,
  type IssueListError,
  type IssueListResult,
} from '@shared/issue-providers';
import type { RepositoryRef } from '@shared/repository-ref';
import { err, ok, type Result } from '@shared/result';
import type { Issue } from '@shared/tasks';
import { githubAccountRegistry } from './accounts/github-account-registry-instance';
import type { GitHubApiAuthContext } from './services/github-api-auth-service';
import { githubConnectionService } from './services/github-connection-service';
import { githubRepositoryResolver } from './services/github-repository-resolver';
import { issueService } from './services/issue-service';
import { resolveProjectGitHubAuthContext } from './services/project-github-auth-context';

function toIssue(raw: {
  number: number;
  title: string;
  url: string;
  state: string;
  updatedAt: string | null;
  assignees: Array<{ login: string }>;
  body?: string | null;
}): Issue {
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

function toIssueListResult(result: Result<Issue[], IssueListError>): IssueListResult {
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
  limit: number,
  authContext?: GitHubApiAuthContext
): Promise<Result<Issue[], IssueListError>> {
  const issues = await issueService.listIssues(repository, limit, authContext);
  if (!issues.success) return err(issues.error);
  return ok(issues.data.map(toIssue));
}

async function searchIssues(
  repository: RepositoryRef,
  searchTerm: string,
  limit: number,
  authContext?: GitHubApiAuthContext
): Promise<Result<Issue[], IssueListError>> {
  if (!normalizeSearchTerm(searchTerm)) {
    return ok([]);
  }

  const issues = await issueService.searchIssues(repository, searchTerm, limit, authContext);
  if (!issues.success) return err(issues.error);
  return ok(issues.data.map(toIssue));
}

async function resolveIssueAuthContext(
  projectId: string | undefined
): Promise<Result<GitHubApiAuthContext | undefined, IssueListError>> {
  if (!projectId) return ok(undefined);
  const authContext = await resolveProjectGitHubAuthContext(projectId);
  if (authContext.success) return ok(authContext.data);
  return err({
    type: 'generic',
    message: `Unable to resolve GitHub account for project: ${authContext.error.message}`,
  });
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

async function getDefaultLinkedAccountConnection() {
  const defaultAccountId = await githubAccountRegistry.getDefaultAccountId();
  if (!defaultAccountId) return null;

  const account = (await githubAccountRegistry.listAccounts()).find(
    (candidate) => candidate.id === defaultAccountId
  );
  if (!account) return null;

  const token = await githubAccountRegistry.resolveToken(account.id);
  if (!token) return null;

  return {
    connected: true,
    displayName: account.login,
    capabilities: ISSUE_PROVIDER_CAPABILITIES.github,
  };
}

export const githubIssueProvider: IssueProvider = {
  type: 'github',
  capabilities: ISSUE_PROVIDER_CAPABILITIES.github,

  checkConnection: async () => {
    const linkedAccountConnection = await getDefaultLinkedAccountConnection();
    if (linkedAccountConnection) return linkedAccountConnection;

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

    const authContext = await resolveIssueAuthContext(opts.projectId);
    if (!authContext.success) return toIssueListResult(err(authContext.error));
    return toIssueListResult(await listIssues(repository.data, opts.limit ?? 50, authContext.data));
  },

  searchIssues: async (opts) => {
    const repository = await resolveRepository(opts);
    if (!repository.success) return toIssueListResult(repository);

    const authContext = await resolveIssueAuthContext(opts.projectId);
    if (!authContext.success) return toIssueListResult(err(authContext.error));
    return toIssueListResult(
      await searchIssues(repository.data, opts.searchTerm, opts.limit ?? 20, authContext.data)
    );
  },
};
