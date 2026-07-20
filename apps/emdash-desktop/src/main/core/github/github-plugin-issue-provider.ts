import type { IssuesPluginProvider } from '@emdash/plugins/issues';
import { err, ok, type Result } from '@emdash/shared';
import { match, P } from 'ts-pattern';
import type {
  IssueProvider,
  IssueQueryOpts,
  IssueSearchOpts,
} from '@core/features/issues/node/issue-provider';
import {
  clampIssueProviderLimit,
  DEFAULT_LIST_LIMIT,
  DEFAULT_SEARCH_LIMIT,
  toIssueProviderCapabilities,
  toLinkedIssue,
} from '@core/features/issues/node/plugin-issue-adapter';
import {
  type IssueListError,
  type IssueListResult,
  type IssueProviderCapabilities,
} from '@core/primitives/issue-providers/api';
import type { RepositoryRef } from '@core/primitives/repository/api';
import { GITHUB_PROVIDER_ID, toGitHubAccount } from '@main/core/github/accounts/github-accounts';
import type { GitHubApiAuthContext } from '@main/core/github/services/github-api-auth-service';
import { githubApiAuthService } from '@main/core/github/services/github-api-auth-service-instance';
import { githubApiBaseUrlForHost } from '@main/core/github/services/github-api-base-url';
import { githubRepositoryResolver } from '@main/core/github/services/github-repository-resolver';
import { resolveProjectGitHubAuthContext } from '@main/core/github/services/project-github-auth-context';
import { providerAccountRegistry } from '@main/core/provider-accounts/provider-account-registry-instance';
import { log } from '@main/lib/logger';

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

  const error = match(resolved.error)
    .returnType<IssueListError>()
    .with({ type: 'not_parseable' }, () => ({
      type: 'invalid_input',
      message: 'Repository URL is required.',
    }))
    .with({ type: 'not_github' }, (e) => ({
      type: 'unsupported_host',
      message: `Remote host "${e.host}" does not appear to be GitHub or GitHub Enterprise.`,
    }))
    .with(P.union({ type: 'host_unreachable' }, { type: 'host_error' }), (e) => ({
      type: 'host_unreachable',
      message: e.reason,
    }))
    .exhaustive();
  return err(error);
}

async function resolveGitHubPluginCredentials(
  repository: RepositoryRef,
  authContext: GitHubApiAuthContext | undefined
): Promise<Result<{ accessToken: string; apiBaseUrl: string }, IssueListError>> {
  const token = await githubApiAuthService.getToken(repository.host, authContext);
  if (!token.success) return err(token.error);
  return ok({ accessToken: token.data, apiBaseUrl: githubApiBaseUrlForHost(repository.host) });
}

async function getDefaultLinkedAccountConnection(capabilities: IssueProviderCapabilities) {
  const defaultAccountId = await providerAccountRegistry.getDefaultAccountId(GITHUB_PROVIDER_ID);
  if (!defaultAccountId) return null;

  const account = (await providerAccountRegistry.listAccounts(GITHUB_PROVIDER_ID))
    .map(toGitHubAccount)
    .find((candidate) => candidate.id === defaultAccountId);
  if (!account) return null;

  const token = await githubApiAuthService.getToken(account.host, { accountId: account.id });
  if (!token.success) return null;

  return {
    connected: true,
    displayName: account.login,
    capabilities,
  };
}

export function createGitHubPluginIssueProvider(plugin: IssuesPluginProvider): IssueProvider {
  const capabilities = toIssueProviderCapabilities(plugin);
  const pluginLog = log.child({ integration: 'github' });

  async function invoke(
    opts: IssueQueryOpts,
    kind: 'list' | 'search',
    searchTerm?: string
  ): Promise<IssueListResult> {
    const repository = await resolveRepository(opts);
    if (!repository.success) return repository;

    const authContext = await resolveIssueAuthContext(opts.projectId);
    if (!authContext.success) return err(authContext.error);

    const credentials = await resolveGitHubPluginCredentials(repository.data, authContext.data);
    if (!credentials.success) return err(credentials.error);

    const host = { log: pluginLog, credentials: credentials.data };
    const behavior = plugin.behavior.issues;
    const result =
      kind === 'search'
        ? await behavior?.searchIssues?.(host, {
            limit: clampIssueProviderLimit(opts.limit, DEFAULT_SEARCH_LIMIT),
            searchTerm: searchTerm ?? '',
            repositoryUrl: repository.data.repositoryUrl,
          })
        : await behavior?.listIssues?.(host, {
            limit: clampIssueProviderLimit(opts.limit, DEFAULT_LIST_LIMIT),
            repositoryUrl: repository.data.repositoryUrl,
          });

    if (!result) return ok([]);
    if (!result.success) return err(result.error);

    return ok(result.data.map((issue) => toLinkedIssue('github', issue)));
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
      if (!String(opts.searchTerm || '').trim()) return Promise.resolve(ok([]));
      return invoke(opts, 'search', opts.searchTerm);
    },
  };
}
