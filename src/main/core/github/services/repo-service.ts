import type { Octokit } from '@octokit/rest';
import { getOctokit } from './octokit-provider';

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
  listRepositories(): Promise<GitHubRepo[]>;
  getOwners(): Promise<GitHubOwner[]>;
  createRepository(params: {
    name: string;
    description?: string;
    owner: string;
    isPrivate: boolean;
  }): Promise<{ url: string; defaultBranch: string; nameWithOwner: string }>;
  deleteRepository(owner: string, name: string): Promise<void>;
  checkRepositoryExists(owner: string, name: string): Promise<boolean>;
  validateRepositoryName(name: string): { valid: boolean; error?: string };
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

const RESERVED_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

export class GitHubRepositoryServiceImpl implements GitHubRepositoryService {
  constructor(private readonly getOctokit: () => Promise<Octokit>) {}

  async listRepositories(): Promise<GitHubRepo[]> {
    const octokit = await this.getOctokit();
    const { data } = await octokit.rest.repos.listForAuthenticatedUser({
      per_page: 100,
      sort: 'updated',
      direction: 'desc',
    });
    return data.map((item) => this.mapRepo(item as unknown as RestRepo));
  }

  async getOwners(): Promise<GitHubOwner[]> {
    const octokit = await this.getOctokit();
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
  }): Promise<{ url: string; defaultBranch: string; nameWithOwner: string }> {
    const octokit = await this.getOctokit();
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

  async deleteRepository(owner: string, name: string): Promise<void> {
    const octokit = await this.getOctokit();
    await octokit.rest.repos.delete({ owner, repo: name });
  }

  async checkRepositoryExists(owner: string, name: string): Promise<boolean> {
    const octokit = await this.getOctokit();
    try {
      await octokit.rest.repos.get({ owner, repo: name });
      return true;
    } catch (err: unknown) {
      if (err != null && typeof err === 'object' && 'status' in err && err.status === 404) {
        return false;
      }
      throw err;
    }
  }

  validateRepositoryName(name: string): { valid: boolean; error?: string } {
    if (!name || name.length === 0) {
      return { valid: false, error: 'Repository name is required' };
    }

    if (name.length > 100) {
      return { valid: false, error: 'Repository name must be 100 characters or fewer' };
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
      return {
        valid: false,
        error: 'Repository name may only contain letters, numbers, hyphens, underscores, and dots',
      };
    }

    if (/^\.+$/.test(name)) {
      return { valid: false, error: 'Repository name cannot consist entirely of dots' };
    }

    if (/^[-._]/.test(name) || /[-._]$/.test(name)) {
      return {
        valid: false,
        error: 'Repository name must not start or end with a hyphen, dot, or underscore',
      };
    }

    if (RESERVED_NAMES.has(name.toLowerCase())) {
      return { valid: false, error: `"${name}" is a reserved name and cannot be used` };
    }

    return { valid: true };
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

export const repoService = new GitHubRepositoryServiceImpl(getOctokit);
