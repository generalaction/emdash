import type { Octokit } from '@octokit/rest';
import type { ReadGitHubCredentials } from '@core/features/github/api/node/services/github-credentials';
import { isGitHubAccountSummary } from '@core/primitives/github/api';
import type { GitHubOwner } from '@core/primitives/github/api';
import { resolveProviderAccount } from '@core/primitives/project-settings/api';
import { providerAccountHostMatching } from '@core/primitives/project-settings/api/resolve-provider-account';
import type { ProviderAccountSummary } from '@core/primitives/provider-accounts/api';
import { githubApiAccountNotFound, githubApiAuthRequired } from './github-api-auth-errors';
import { GitHubApiAuthErrorException, getOctokit } from './octokit-provider';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitHubRepo {
  id: number;
  name: string;
  nameWithOwner: string;
  description: string | null;
  url: string;
  cloneUrl: string;
  sshUrl: string;
  defaultBranch: string;
  isPrivate: boolean;
  updatedAt: string | null;
  language: string | null;
  stargazersCount: number;
  forksCount: number;
}

export type GitHubRepositoryAccountContext = { accountId?: string };

export interface GitHubRepositoryService {
  listRepositories(authContext?: GitHubRepositoryAccountContext): Promise<GitHubRepo[]>;
  getOwners(authContext?: GitHubRepositoryAccountContext): Promise<GitHubOwner[]>;
  createRepository(params: {
    name: string;
    description?: string;
    owner: string;
    isPrivate: boolean;
    authContext?: GitHubRepositoryAccountContext;
  }): Promise<{ url: string; cloneUrl: string; defaultBranch: string; nameWithOwner: string }>;
  deleteRepository(
    owner: string,
    name: string,
    authContext?: GitHubRepositoryAccountContext
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// REST response shape (internal)
// ---------------------------------------------------------------------------

interface RestRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  default_branch: string;
  private: boolean;
  updated_at: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class GitHubRepositoryServiceImpl implements GitHubRepositoryService {
  constructor(
    private readonly getOctokit: (context: GitHubRepositoryAccountContext) => Promise<Octokit>
  ) {}

  async listRepositories(authContext: GitHubRepositoryAccountContext = {}): Promise<GitHubRepo[]> {
    const octokit = await this.getOctokit(authContext);
    const { data } = await octokit.rest.repos.listForAuthenticatedUser({
      per_page: 100,
      sort: 'updated',
      direction: 'desc',
    });
    return data.map((item) => this.mapRepo(item as unknown as RestRepo));
  }

  async getOwners(authContext: GitHubRepositoryAccountContext = {}): Promise<GitHubOwner[]> {
    const octokit = await this.getOctokit(authContext);
    const { data: user } = await octokit.rest.users.getAuthenticated();
    const owners: GitHubOwner[] = [{ login: user.login, type: 'User', avatarUrl: user.avatar_url }];

    try {
      const { data: orgs } = await octokit.rest.orgs.listForAuthenticatedUser();
      for (const org of orgs) {
        owners.push({ login: org.login, type: 'Organization', avatarUrl: org.avatar_url });
      }
    } catch {}

    return owners;
  }

  async createRepository(params: {
    name: string;
    description?: string;
    owner: string;
    isPrivate: boolean;
    authContext?: GitHubRepositoryAccountContext;
  }): Promise<{ url: string; cloneUrl: string; defaultBranch: string; nameWithOwner: string }> {
    const octokit = await this.getOctokit(params.authContext ?? {});
    const { data: user } = await octokit.rest.users.getAuthenticated();
    const isCurrentUser = params.owner === user.login;

    const createParams = {
      name: params.name,
      description: params.description,
      private: params.isPrivate,
      auto_init: true,
    };

    const { data } = isCurrentUser
      ? await octokit.rest.repos.createForAuthenticatedUser(createParams)
      : await octokit.rest.repos.createInOrg({ ...createParams, org: params.owner });

    return {
      url: data.html_url,
      cloneUrl: data.clone_url,
      defaultBranch: data.default_branch,
      nameWithOwner: data.full_name,
    };
  }

  async deleteRepository(
    owner: string,
    name: string,
    authContext: GitHubRepositoryAccountContext = {}
  ): Promise<void> {
    const octokit = await this.getOctokit(authContext);
    await octokit.rest.repos.delete({ owner, repo: name });
  }

  private mapRepo(item: RestRepo): GitHubRepo {
    return {
      id: item.id,
      name: item.name,
      nameWithOwner: item.full_name,
      description: item.description,
      url: item.html_url,
      cloneUrl: item.clone_url,
      sshUrl: item.ssh_url,
      defaultBranch: item.default_branch,
      isPrivate: item.private,
      updatedAt: item.updated_at,
      language: item.language,
      stargazersCount: item.stargazers_count,
      forksCount: item.forks_count,
    };
  }
}

export function createGitHubRepositoryService(deps: {
  listAccounts(): Promise<ProviderAccountSummary[]>;
  readCredentials: ReadGitHubCredentials;
}): GitHubRepositoryService {
  return new GitHubRepositoryServiceImpl(async (context) => {
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
    const octokit = await getOctokit(deps.readCredentials, account.accountId, account.host);
    if (!octokit.success) throw new GitHubApiAuthErrorException(octokit.error);
    return octokit.data;
  });
}
