import type { Octokit } from '@octokit/rest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubRepositoryServiceImpl } from './repo-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOctokit(
  overrides: Partial<{
    reposListForAuthenticatedUser: ReturnType<typeof vi.fn>;
    usersGetAuthenticated: ReturnType<typeof vi.fn>;
    orgsListForAuthenticatedUser: ReturnType<typeof vi.fn>;
    reposCreateForAuthenticatedUser: ReturnType<typeof vi.fn>;
    reposCreateInOrg: ReturnType<typeof vi.fn>;
    reposDelete: ReturnType<typeof vi.fn>;
    reposGet: ReturnType<typeof vi.fn>;
  }> = {}
): Octokit {
  return {
    rest: {
      repos: {
        listForAuthenticatedUser:
          overrides.reposListForAuthenticatedUser ?? vi.fn().mockResolvedValue({ data: [] }),
        createForAuthenticatedUser: overrides.reposCreateForAuthenticatedUser ?? vi.fn(),
        createInOrg: overrides.reposCreateInOrg ?? vi.fn(),
        delete: overrides.reposDelete ?? vi.fn().mockResolvedValue({}),
        get: overrides.reposGet ?? vi.fn(),
      },
      users: {
        getAuthenticated:
          overrides.usersGetAuthenticated ??
          vi.fn().mockResolvedValue({ data: { login: 'testuser' } }),
      },
      orgs: {
        listForAuthenticatedUser:
          overrides.orgsListForAuthenticatedUser ?? vi.fn().mockResolvedValue({ data: [] }),
      },
    },
  } as unknown as Octokit;
}

// REST-shaped mock data (snake_case)
const restRepo = {
  id: 1,
  name: 'my-repo',
  full_name: 'testuser/my-repo',
  description: 'A test repo',
  html_url: 'https://github.com/testuser/my-repo',
  clone_url: 'https://github.com/testuser/my-repo.git',
  ssh_url: 'git@github.com:testuser/my-repo.git',
  default_branch: 'main',
  private: false,
  updated_at: '2024-01-01T00:00:00Z',
  language: 'TypeScript',
  stargazers_count: 10,
  forks_count: 2,
};

// Expected camelCase output
const expectedRepo = {
  id: 1,
  name: 'my-repo',
  nameWithOwner: 'testuser/my-repo',
  description: 'A test repo',
  url: 'https://github.com/testuser/my-repo',
  cloneUrl: 'https://github.com/testuser/my-repo.git',
  sshUrl: 'git@github.com:testuser/my-repo.git',
  defaultBranch: 'main',
  isPrivate: false,
  updatedAt: '2024-01-01T00:00:00Z',
  language: 'TypeScript',
  stargazersCount: 10,
  forksCount: 2,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GitHubRepositoryServiceImpl', () => {
  describe('listRepositories', () => {
    it('maps REST response to camelCase', async () => {
      const octokit = makeOctokit({
        reposListForAuthenticatedUser: vi.fn().mockResolvedValue({ data: [restRepo] }),
      });
      const svc = new GitHubRepositoryServiceImpl(octokit);

      const result = await svc.listRepositories();

      expect(result).toEqual([expectedRepo]);
    });
  });

  describe('getOwners', () => {
    it('returns user + orgs', async () => {
      const octokit = makeOctokit({
        orgsListForAuthenticatedUser: vi.fn().mockResolvedValue({ data: [{ login: 'acme' }] }),
      });
      const svc = new GitHubRepositoryServiceImpl(octokit);

      const owners = await svc.getOwners();

      expect(owners).toEqual([
        { login: 'testuser', type: 'User' },
        { login: 'acme', type: 'Organization' },
      ]);
    });

    it('returns user only if orgs fail', async () => {
      const octokit = makeOctokit({
        orgsListForAuthenticatedUser: vi.fn().mockRejectedValue(new Error('forbidden')),
      });
      const svc = new GitHubRepositoryServiceImpl(octokit);

      const owners = await svc.getOwners();

      expect(owners).toEqual([{ login: 'testuser', type: 'User' }]);
    });
  });

  describe('createRepository', () => {
    it('creates for authenticated user', async () => {
      const octokit = makeOctokit({
        reposCreateForAuthenticatedUser: vi.fn().mockResolvedValue({
          data: {
            html_url: 'https://github.com/testuser/new',
            default_branch: 'main',
            full_name: 'testuser/new',
          },
        }),
      });
      const svc = new GitHubRepositoryServiceImpl(octokit);

      const result = await svc.createRepository({
        name: 'new',
        owner: 'testuser',
        isPrivate: false,
      });

      expect(octokit.rest.repos.createForAuthenticatedUser).toHaveBeenCalled();
      expect(result).toEqual({
        url: 'https://github.com/testuser/new',
        defaultBranch: 'main',
        nameWithOwner: 'testuser/new',
      });
    });

    it('creates in org when owner differs', async () => {
      const octokit = makeOctokit({
        reposCreateInOrg: vi.fn().mockResolvedValue({
          data: {
            html_url: 'https://github.com/acme/new',
            default_branch: 'main',
            full_name: 'acme/new',
          },
        }),
      });
      const svc = new GitHubRepositoryServiceImpl(octokit);

      await svc.createRepository({ name: 'new', owner: 'acme', isPrivate: true });

      expect(octokit.rest.repos.createInOrg).toHaveBeenCalledWith(
        expect.objectContaining({ org: 'acme', name: 'new', private: true })
      );
    });
  });

  describe('deleteRepository', () => {
    it('calls repos.delete', async () => {
      const octokit = makeOctokit();
      const svc = new GitHubRepositoryServiceImpl(octokit);

      await svc.deleteRepository('testuser', 'old-repo');

      expect(octokit.rest.repos.delete).toHaveBeenCalledWith({
        owner: 'testuser',
        repo: 'old-repo',
      });
    });
  });

  describe('checkRepositoryExists', () => {
    it('returns true when found', async () => {
      const octokit = makeOctokit({
        reposGet: vi.fn().mockResolvedValue({ data: {} }),
      });
      const svc = new GitHubRepositoryServiceImpl(octokit);

      expect(await svc.checkRepositoryExists('testuser', 'repo')).toBe(true);
    });

    it('returns false on 404', async () => {
      const octokit = makeOctokit({
        reposGet: vi.fn().mockRejectedValue({ status: 404 }),
      });
      const svc = new GitHubRepositoryServiceImpl(octokit);

      expect(await svc.checkRepositoryExists('testuser', 'missing')).toBe(false);
    });

    it('throws on non-404 errors', async () => {
      const octokit = makeOctokit({
        reposGet: vi.fn().mockRejectedValue({ status: 500 }),
      });
      const svc = new GitHubRepositoryServiceImpl(octokit);

      await expect(svc.checkRepositoryExists('testuser', 'repo')).rejects.toEqual({ status: 500 });
    });
  });

  describe('validateRepositoryName', () => {
    let svc: GitHubRepositoryServiceImpl;

    beforeEach(() => {
      svc = new GitHubRepositoryServiceImpl(makeOctokit());
    });

    it('accepts valid names', () => {
      expect(svc.validateRepositoryName('my-repo')).toEqual({ valid: true });
      expect(svc.validateRepositoryName('repo.js')).toEqual({ valid: true });
      expect(svc.validateRepositoryName('my_repo_123')).toEqual({ valid: true });
    });

    it('rejects empty names', () => {
      expect(svc.validateRepositoryName('')).toEqual({
        valid: false,
        error: 'Repository name is required',
      });
    });

    it('rejects names over 100 chars', () => {
      expect(svc.validateRepositoryName('a'.repeat(101)).valid).toBe(false);
    });

    it('rejects invalid characters', () => {
      expect(svc.validateRepositoryName('my repo').valid).toBe(false);
      expect(svc.validateRepositoryName('repo@name').valid).toBe(false);
    });

    it('rejects names starting/ending with special chars', () => {
      expect(svc.validateRepositoryName('-repo').valid).toBe(false);
      expect(svc.validateRepositoryName('repo-').valid).toBe(false);
      expect(svc.validateRepositoryName('.repo').valid).toBe(false);
    });

    it('rejects all-dots names', () => {
      expect(svc.validateRepositoryName('...').valid).toBe(false);
    });

    it('rejects reserved names', () => {
      expect(svc.validateRepositoryName('CON').valid).toBe(false);
      expect(svc.validateRepositoryName('nul').valid).toBe(false);
      expect(svc.validateRepositoryName('COM1').valid).toBe(false);
    });
  });
});
