import { err, ok, type Result } from '@emdash/shared';
import { match, P } from 'ts-pattern';
import { normalizeSearchTerm } from '@main/core/issues/helpers/provider-inputs';
import type { IssueProvider } from '@main/core/issues/issue-provider';
import type { LinkedIssue } from '@shared/core/linked-issue';
import {
  ISSUE_PROVIDER_CAPABILITIES,
  type IssueListError,
  type IssueListResult,
} from '@shared/issue-providers';
import type { RepositoryRef } from '@shared/repository-ref';
import { githubAccountRegistry } from './accounts/github-account-registry-instance';
import type { GitHubApiAuthContext } from './services/github-api-auth-service';
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
    ...issueListErrorMetadata(result.error),
  };
}

type IssueListErrorMetadata = Omit<
  Extract<IssueListResult, { success: false }>,
  'success' | 'error' | 'errorType'
>;

function issueListErrorMetadata(error: IssueListError): IssueListErrorMetadata {
  return match(error)
    .with(
      P.union({ type: 'no_account_selected' }, { type: 'account_disabled' }, { type: 'generic' }),
      () => ({})
    )
    .with({ type: 'account_not_found' }, (e) => ({
      ...(e.host ? { host: e.host } : {}),
      ...(e.accountId ? { accountId: e.accountId } : {}),
    }))
    .with({ type: 'account_host_mismatch' }, (e) => ({
      host: e.host,
      accountId: e.accountId,
      accountHost: e.accountHost,
    }))
    .with({ type: 'token_missing' }, (e) => ({
      host: e.host,
      accountId: e.accountId,
    }))
    .with(
      P.union(
        { type: 'auth_required' },
        { type: 'not_found_or_no_access' },
        { type: 'forbidden' },
        { type: 'host_unreachable' },
        { type: 'unsupported_host' }
      ),
      (e) => ({ host: e.host })
    )
    .with({ type: 'sso_required' }, (e) => ({
      host: e.host,
      ...(e.ssoUrl ? { ssoUrl: e.ssoUrl } : {}),
    }))
    .with({ type: 'rate_limited' }, (e) => ({
      host: e.host,
      ...(e.resetAt ? { resetAt: e.resetAt } : {}),
    }))
    .exhaustive();
}

async function listIssues(
  repository: RepositoryRef,
  limit: number,
  authContext?: GitHubApiAuthContext
): Promise<Result<LinkedIssue[], IssueListError>> {
  const issues = await issueService.listIssues(repository, limit, authContext);
  if (!issues.success) return err(issues.error);
  return ok(issues.data.map(toIssue));
}

async function searchIssues(
  repository: RepositoryRef,
  searchTerm: string,
  limit: number,
  authContext?: GitHubApiAuthContext
): Promise<Result<LinkedIssue[], IssueListError>> {
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
  if (authContext.error.type === 'unconfigured') {
    return err({
      type: 'no_account_selected',
      message: authContext.error.message,
    });
  }
  if (authContext.error.type === 'disabled') {
    return err({
      type: 'account_disabled',
      message: authContext.error.message,
    });
  }
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

  return match(resolved.error)
    .with({ type: 'not_parseable' }, () =>
      err({ type: 'generic' as const, message: 'Repository URL is required.' })
    )
    .with({ type: 'not_github' }, (e) =>
      err({
        type: 'unsupported_host' as const,
        host: e.host,
        message: 'This remote does not appear to be GitHub or GitHub Enterprise.',
      })
    )
    .with(P.union({ type: 'host_unreachable' }, { type: 'host_error' }), (e) =>
      err({ type: 'host_unreachable' as const, host: e.host, message: e.reason })
    )
    .exhaustive();
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

  isConfigured: async () => (await githubAccountRegistry.listAccounts()).length > 0,

  checkConnection: async () => {
    const linkedAccountConnection = await getDefaultLinkedAccountConnection();
    if (linkedAccountConnection) return linkedAccountConnection;

    return {
      connected: false,
      displayName: undefined,
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
