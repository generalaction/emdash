import type { Octokit } from '@octokit/rest';
import { describe, expect, it, vi } from 'vitest';
import { getOctokit } from './octokit-provider';
import { repoService } from './repo-service';

vi.mock('./octokit-provider', () => ({
  getOctokit: vi.fn(),
}));

const mockGetOctokit = vi.mocked(getOctokit);

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
      mockGetOctokit.mockResolvedValue(octokit);

      const result = await repoService.listRepositories();

      expect(result).toEqual([expectedRepo]);
    });
  });

  describe('getOwners', () => {
    it('returns user + orgs', async () => {
      const octokit = makeOctokit({
        orgsListForAuthenticatedUser: vi.fn().mockResolvedValue({ data: [{ login: 'acme' }] }),
      });
      mockGetOctokit.mockResolvedValue(octokit);

      const owners = await repoService.getOwners();

      expect(owners).toEqual([
        { login: 'testuser', type: 'User' },
        { login: 'acme', type: 'Organization' },
      ]);
    });

    it('returns user only if orgs fail', async () => {
      const octokit = makeOctokit({
        orgsListForAuthenticatedUser: vi.fn().mockRejectedValue(new Error('forbidden')),
      });
      mockGetOctokit.mockResolvedValue(octokit);

      const owners = await repoService.getOwners();

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
      mockGetOctokit.mockResolvedValue(octokit);

      const result = await repoService.createRepository({
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
      mockGetOctokit.mockResolvedValue(octokit);

      await repoService.createRepository({ name: 'new', owner: 'acme', isPrivate: true });

      expect(octokit.rest.repos.createInOrg).toHaveBeenCalledWith(
        expect.objectContaining({ org: 'acme', name: 'new', private: true })
      );
    });
  });

  describe('deleteRepository', () => {
    it('calls repos.delete', async () => {
      const octokit = makeOctokit();
      mockGetOctokit.mockResolvedValue(octokit);

      await repoService.deleteRepository('testuser', 'old-repo');

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
      mockGetOctokit.mockResolvedValue(octokit);

      expect(await repoService.checkRepositoryExists('testuser', 'repo')).toBe(true);
    });

    it('returns false on 404', async () => {
      const octokit = makeOctokit({
        reposGet: vi.fn().mockRejectedValue({ status: 404 }),
      });
      mockGetOctokit.mockResolvedValue(octokit);

      expect(await repoService.checkRepositoryExists('testuser', 'missing')).toBe(false);
    });

    it('throws on non-404 errors', async () => {
      const octokit = makeOctokit({
        reposGet: vi.fn().mockRejectedValue({ status: 500 }),
      });
      mockGetOctokit.mockResolvedValue(octokit);

      await expect(repoService.checkRepositoryExists('testuser', 'repo')).rejects.toEqual({
        status: 500,
      });
    });
  });

  describe('validateRepositoryName', () => {
    it('accepts valid names', () => {
      expect(repoService.validateRepositoryName('my-repo')).toEqual({ valid: true });
      expect(repoService.validateRepositoryName('repo.js')).toEqual({ valid: true });
      expect(repoService.validateRepositoryName('my_repo_123')).toEqual({ valid: true });
    });

    it('rejects empty names', () => {
      expect(repoService.validateRepositoryName('')).toEqual({
        valid: false,
        error: 'Repository name is required',
      });
    });

    it('rejects names over 100 chars', () => {
      expect(repoService.validateRepositoryName('a'.repeat(101)).valid).toBe(false);
    });

    it('rejects invalid characters', () => {
      expect(repoService.validateRepositoryName('my repo').valid).toBe(false);
      expect(repoService.validateRepositoryName('repo@name').valid).toBe(false);
    });

    it('rejects names starting/ending with special chars', () => {
      expect(repoService.validateRepositoryName('-repo').valid).toBe(false);
      expect(repoService.validateRepositoryName('repo-').valid).toBe(false);
      expect(repoService.validateRepositoryName('.repo').valid).toBe(false);
    });

    it('rejects all-dots names', () => {
      expect(repoService.validateRepositoryName('...').valid).toBe(false);
    });

    it('rejects reserved names', () => {
      expect(repoService.validateRepositoryName('CON').valid).toBe(false);
      expect(repoService.validateRepositoryName('nul').valid).toBe(false);
      expect(repoService.validateRepositoryName('COM1').valid).toBe(false);
    });
  });
});
