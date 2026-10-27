import type { RepositoryOwner } from '@agent/plugins/repository';
import { repositoryPluginRegistry, type RepositoryPluginProvider } from '@agent/plugins/repository';
import { log } from '@agent/shared/logger';
import type { ReadGitHubCredentials } from '@core/features/github/api/node/services/github-credentials';
import { isGitHubAccountSummary } from '@core/primitives/github/api';
import { resolveProviderAccount } from '@core/primitives/project-settings/api';
import { providerAccountHostMatching } from '@core/primitives/project-settings/api/resolve-provider-account';
import type { ProviderAccountSummary } from '@core/primitives/provider-accounts/api';
import { githubApiAccountNotFound, githubApiAuthRequired } from './github-api-auth-errors';
import { GitHubApiAuthErrorException } from './octokit-provider';

export type GitHubRepositoryAccountContext = { accountId?: string };

export interface GitHubRepositoryService {
  getOwners(authContext?: GitHubRepositoryAccountContext): Promise<RepositoryOwner[]>;
  createRepository(params: {
    name: string;
    description?: string;
    owner: string;
    isPrivate: boolean;
    initializeWithReadme?: boolean;
    authContext?: GitHubRepositoryAccountContext;
  }): Promise<{ url: string; cloneUrl: string; defaultBranch: string; nameWithOwner: string }>;
  deleteRepository(
    owner: string,
    name: string,
    authContext?: GitHubRepositoryAccountContext
  ): Promise<void>;
}

/**
 * GitHub's hosted-repository operations through the GitHub repository plugin.
 * Without an explicit account, the github.com account is inferred; a removed
 * explicit account fails and never falls back to another identity.
 */
export function createGitHubRepositoryService(deps: {
  listAccounts(): Promise<ProviderAccountSummary[]>;
  readCredentials: ReadGitHubCredentials;
  plugin?: RepositoryPluginProvider;
}): GitHubRepositoryService {
  const behavior = (deps.plugin ?? repositoryPluginRegistry.get('github'))?.behavior.repository;
  if (!behavior) throw new Error('GitHub repository plugin is not registered.');
  const pluginLog = log.child({ integration: 'github' });

  async function host(context: GitHubRepositoryAccountContext = {}) {
    const accounts = (await deps.listAccounts()).filter(isGitHubAccountSummary);
    const accountId = context.accountId?.trim();
    const account = resolveProviderAccount(
      accountId ? { kind: 'account', accountId } : undefined,
      accounts,
      accountId ? undefined : providerAccountHostMatching('github.com')
    ).value;
    if (!account) {
      throw new GitHubApiAuthErrorException(
        accountId
          ? githubApiAccountNotFound('github.com', accountId)
          : githubApiAuthRequired('github.com')
      );
    }
    const credentials = await deps.readCredentials(account.accountId, account.host);
    if (!credentials.success) throw new GitHubApiAuthErrorException(credentials.error);
    return { log: pluginLog, credentials: credentials.data };
  }

  function unwrap<T>(
    result: { success: true; data: T } | { success: false; error: { message: string } }
  ): T {
    if (!result.success) throw new Error(result.error.message);
    return result.data;
  }

  return {
    async getOwners(authContext) {
      return unwrap(await behavior.listOwners(await host(authContext)));
    },
    async createRepository(params) {
      const created = unwrap(
        await behavior.createRepository(await host(params.authContext), {
          owner: params.owner,
          name: params.name,
          description: params.description,
          visibility: params.isPrivate ? 'private' : 'public',
          initializeWithReadme: params.initializeWithReadme,
        })
      );
      return {
        url: created.repositoryUrl,
        cloneUrl: created.cloneUrl,
        defaultBranch: created.defaultBranch,
        nameWithOwner: created.nameWithOwner,
      };
    },
    async deleteRepository(owner, name, authContext) {
      unwrap(await behavior.deleteRepository(await host(authContext), { owner, name }));
    },
  };
}
