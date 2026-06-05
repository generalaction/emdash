import type { Octokit } from '@octokit/rest';
import type { GitHubApiAuthContext } from './github-api-auth-service';
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

export interface GitHubOwner {
  login: string;
  type: 'User' | 'Organization';
}

export interface GitHubRepositoryService {
  listRepositories(authContext?: GitHubApiAuthContext): Promise<GitHubRepo[]>;
  getOwners(authContext?: GitHubApiAuthContext): Promise<GitHubOwner[]>;
  createRepository(params: {
    name: string;
    description?: string;
    owner: string;
    isPrivate: boolean;
    authContext?: GitHubApiAuthContext;
  }): Promise<{ url: string; defaultBranch: string; nameWithOwner: string }>;
  deleteRepository(owner: string, name: string, authContext?: GitHubApiAuthContext): Promise<void>;
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
    private readonly getOctokit: (authContext?: GitHubApiAuthContext) => Promise<Octokit>
  ) {}

  async listRepositories(authContext: GitHubApiAuthContext = {}): Promise<GitHubRepo[]> {
    const octokit = await this.getOctokit(authContext);
    const { data } = await octokit.rest.repos.listForAuthenticatedUser({
      per_page: 100,
      sort: 'updated',
      direction: 'desc',
    });
    return data.map((item) => this.mapRepo(item as unknown as RestRepo));
  }

  async getOwners(authContext: GitHubApiAuthContext = {}): Promise<GitHubOwner[]> {
    const octokit = await this.getOctokit(authContext);
    const { data: user } = await octokit.rest.users.getAuthenticated();
    const owners: GitHubOwner[] = [{ login: user.login, type: 'User' }];

    try {
      const { data: orgs } = await octokit.rest.orgs.listForAuthenticatedUser();
      for (const org of orgs) {
        owners.push({ login: org.login, type: 'Organization' });
      }
    } catch {}

    return owners;
  }

  async createRepository(params: {
    name: string;
    description?: string;
    owner: string;
    isPrivate: boolean;
    authContext?: GitHubApiAuthContext;
  }): Promise<{ url: string; defaultBranch: string; nameWithOwner: string }> {
    const octokit = await this.getOctokit(params.authContext);
    const { data: user } = await octokit.rest.users.getAuthenticated();
    const isCurrentUser = params.owner === user.login;

    const createParams = {
      name: params.name,
      description: params.description,
      private: params.isPrivate,
    };

    const { data } = isCurrentUser
      ? await octokit.rest.repos.createForAuthenticatedUser(createParams)
      : await octokit.rest.repos.createInOrg({ ...createParams, org: params.owner });

    return {
      url: data.html_url,
      defaultBranch: data.default_branch || 'main',
      nameWithOwner: data.full_name,
    };
  }

  async deleteRepository(
    owner: string,
    name: string,
    authContext: GitHubApiAuthContext = {}
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

export const repoService = new GitHubRepositoryServiceImpl(async (authContext = {}) => {
  const octokit = await getOctokit('github.com', authContext);
  if (!octokit.success) throw new GitHubApiAuthErrorException(octokit.error);
  return octokit.data;
});
