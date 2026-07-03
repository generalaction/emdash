import type { IssuesPluginProvider, IssueError } from '@emdash/plugins/issues';
import { err, ok, type Result } from '@emdash/shared';
import { match, P } from 'ts-pattern';
import { GITHUB_PROVIDER_ID, toGitHubAccount } from '@main/core/github/accounts/github-accounts';
import type { GitHubApiAuthContext } from '@main/core/github/services/github-api-auth-service';
import { githubApiBaseUrlForHost } from '@main/core/github/services/github-api-base-url';
import { githubRepositoryResolver } from '@main/core/github/services/github-repository-resolver';
import { resolveProjectGitHubAuthContext } from '@main/core/github/services/project-github-auth-context';
import { providerAccountRegistry } from '@main/core/provider-accounts/provider-account-registry-instance';
import { log } from '@main/lib/logger';
import type { LinkedIssue } from '@shared/core/linked-issue';
import {
  type IssueListError,
  type IssueListResult,
  type IssueProviderCapabilities,
} from '@shared/issue-providers';
import { normalizeRepositoryHost } from '@shared/repository-ref';
import type { RepositoryRef } from '@shared/repository-ref';
import type { IssueProvider, IssueQueryOpts, IssueSearchOpts } from '../issues/issue-provider';

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

function mapPluginError(error: IssueError, repository: RepositoryRef): IssueListError {
  if (error.type === 'auth_failed') {
    return { type: 'auth_required', host: repository.host, message: error.message };
  }
  if (error.type === 'rate_limited') {
    return {
      type: 'rate_limited',
      host: repository.host,
      message: error.message,
      ...(error.resetAt ? { resetAt: error.resetAt } : {}),
    };
  }
  if (error.type === 'sso_required') {
    return {
      type: 'sso_required',
      host: repository.host,
      message: error.message,
      ...(error.ssoUrl ? { ssoUrl: error.ssoUrl } : {}),
    };
  }
  if (error.type === 'not_found_or_no_access') {
    return { type: 'not_found_or_no_access', host: repository.host, message: error.message };
  }
  if (error.type === 'host_unreachable') {
    return { type: 'host_unreachable', host: repository.host, message: error.message };
  }
  if (error.type === 'unsupported_host') {
    return { type: 'unsupported_host', host: repository.host, message: error.message };
  }
  return { type: 'generic', message: error.message };
}

async function resolveIssueAuthContext(
  projectId: string | undefined
): Promise<Result<GitHubApiAuthContext | undefined, IssueListError>> {
  if (!projectId) return ok(undefined);
  const authContext = await resolveProjectGitHubAuthContext(projectId);
  if (authContext.success) return ok(authContext.data);
  if (authContext.error.type === 'unconfigured') {
    return err({ type: 'no_account_selected', message: authContext.error.message });
  }
  if (authContext.error.type === 'disabled') {
    return err({ type: 'account_disabled', message: authContext.error.message });
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

async function resolveGitHubPluginCredentials(
  repository: RepositoryRef,
  authContext: GitHubApiAuthContext | undefined
): Promise<Result<{ accessToken: string; apiBaseUrl: string }, IssueListError>> {
  const normalizedHost = normalizeRepositoryHost(repository.host);
  const accounts = (await providerAccountRegistry.listAccounts(GITHUB_PROVIDER_ID)).map(
    toGitHubAccount
  );
  const accountId =
    authContext?.accountId?.trim() ||
    (await providerAccountRegistry.getDefaultAccountId(GITHUB_PROVIDER_ID));
  if (!accountId) {
    return err({
      type: 'auth_required',
      host: normalizedHost,
      message: `Connect a GitHub account for ${normalizedHost}.`,
    });
  }

  const account = accounts.find((candidate) => candidate.id === accountId);
  if (!account) {
    return err({
      type: 'account_not_found',
      host: normalizedHost,
      accountId,
      message: `GitHub account ${accountId} was not found.`,
    });
  }

  const accountHost = normalizeRepositoryHost(account.host);
  if (accountHost !== normalizedHost) {
    return err({
      type: 'account_host_mismatch',
      host: normalizedHost,
      accountId,
      accountHost,
      message: `GitHub account ${account.login} is for ${accountHost}, not ${normalizedHost}.`,
    });
  }

  const accessToken = await providerAccountRegistry.resolveSecret(GITHUB_PROVIDER_ID, account.id);
  if (!accessToken) {
    return err({
      type: 'token_missing',
      host: normalizedHost,
      accountId: account.id,
      message: `GitHub token is missing for ${account.login}.`,
    });
  }

  return ok({ accessToken, apiBaseUrl: githubApiBaseUrlForHost(normalizedHost) });
}

function toCapabilities(plugin: IssuesPluginProvider): IssueProviderCapabilities {
  const requiredInputs = plugin.capabilities.issues.requiredInputs;
  return {
    requiresRepositoryUrl: requiredInputs.includes('repositoryUrl'),
    supportsIssueContext: !!plugin.behavior.issues?.getIssue,
  };
}

async function getDefaultLinkedAccountConnection(capabilities: IssueProviderCapabilities) {
  const defaultAccountId = await providerAccountRegistry.getDefaultAccountId(GITHUB_PROVIDER_ID);
  if (!defaultAccountId) return null;

  const account = (await providerAccountRegistry.listAccounts(GITHUB_PROVIDER_ID))
    .map(toGitHubAccount)
    .find((candidate) => candidate.id === defaultAccountId);
  if (!account) return null;

  const token = await providerAccountRegistry.resolveSecret(GITHUB_PROVIDER_ID, account.id);
  if (!token) return null;

  return {
    connected: true,
    displayName: account.login,
    capabilities,
  };
}

export function createGitHubPluginIssueProvider(plugin: IssuesPluginProvider): IssueProvider {
  const capabilities = toCapabilities(plugin);

  async function invoke(
    opts: IssueQueryOpts,
    kind: 'list' | 'search',
    searchTerm?: string
  ): Promise<IssueListResult> {
    const repository = await resolveRepository(opts);
    if (!repository.success) return toIssueListResult(repository);

    const authContext = await resolveIssueAuthContext(opts.projectId);
    if (!authContext.success) return toIssueListResult(err(authContext.error));

    const credentials = await resolveGitHubPluginCredentials(repository.data, authContext.data);
    if (!credentials.success) return toIssueListResult(err(credentials.error));

    const behavior = plugin.behavior.issues;
    const result =
      kind === 'search'
        ? await behavior?.searchIssues?.(
            { log, credentials: credentials.data },
            {
              limit: opts.limit ?? 20,
              searchTerm: searchTerm ?? '',
              repositoryUrl: repository.data.repositoryUrl,
            }
          )
        : await behavior?.listIssues?.(
            { log, credentials: credentials.data },
            { limit: opts.limit ?? 50, repositoryUrl: repository.data.repositoryUrl }
          );

    if (!result) return { success: true, issues: [] };
    if (!result.success)
      return toIssueListResult(err(mapPluginError(result.error, repository.data)));

    return {
      success: true,
      issues: result.data.map((issue) => ({
        provider: 'github',
        identifier: issue.identifier,
        displayIdentifier: issue.displayIdentifier,
        title: issue.title,
        url: issue.url ?? '',
        description: issue.description,
        status: issue.status,
        assignees: issue.assignees,
        updatedAt: issue.updatedAt,
        fetchedAt: new Date().toISOString(),
      })),
    };
  }

  return {
    type: 'github',
    capabilities,
    isConfigured: async () =>
      (await providerAccountRegistry.listAccounts(GITHUB_PROVIDER_ID)).length > 0,
    checkConnection: async () => {
      const linkedAccountConnection = await getDefaultLinkedAccountConnection(capabilities);
      if (linkedAccountConnection) return linkedAccountConnection;
      return {
        connected: false,
        displayName: undefined,
        capabilities,
      };
    },
    listIssues: (opts) => invoke(opts, 'list'),
    searchIssues: (opts: IssueSearchOpts) => {
      if (!String(opts.searchTerm || '').trim())
        return Promise.resolve({ success: true, issues: [] });
      return invoke(opts, 'search', opts.searchTerm);
    },
  };
}
