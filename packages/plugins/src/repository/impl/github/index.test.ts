import type { Octokit } from '@octokit/rest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ConnectedIntegrationHostContext,
  IntegrationHostContext,
} from '../../../integrations/host';
import { createRepository, deleteRepository, listOwners, probeHost } from './index';

const octokit = vi.hoisted(() => ({
  rest: {
    users: { getAuthenticated: vi.fn() },
    orgs: { listForAuthenticatedUser: vi.fn() },
    repos: { createForAuthenticatedUser: vi.fn(), createInOrg: vi.fn(), delete: vi.fn() },
  },
}));

vi.mock('../../../integrations/impl/github/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../integrations/impl/github/client')>()),
  createGitHubClient: vi.fn(() => octokit),
}));

const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const connected = {
  log,
  credentials: { accessToken: 'token', apiBaseUrl: 'https://api.github.com' },
} as unknown as ConnectedIntegrationHostContext;

const createdRepo = {
  html_url: 'https://github.com/testuser/new',
  clone_url: 'https://github.com/testuser/new.git',
  default_branch: 'main',
  full_name: 'testuser/new',
};

beforeEach(() => {
  vi.clearAllMocks();
  octokit.rest.users.getAuthenticated.mockResolvedValue({
    data: { login: 'testuser', avatar_url: 'https://avatars.githubusercontent.com/u/1' },
  });
  octokit.rest.orgs.listForAuthenticatedUser.mockResolvedValue({ data: [] });
});

describe('GitHub repository plugin', () => {
  it('fails closed on a malformed credential record', async () => {
    const result = await listOwners({
      log,
      credentials: {},
    } as unknown as ConnectedIntegrationHostContext);
    expect(result.success).toBe(false);
    expect(octokit.rest.users.getAuthenticated).not.toHaveBeenCalled();
  });

  describe('listOwners', () => {
    it('returns the user followed by organizations', async () => {
      octokit.rest.orgs.listForAuthenticatedUser.mockResolvedValue({
        data: [{ login: 'acme', avatar_url: 'https://avatars.githubusercontent.com/u/2' }],
      });
      await expect(listOwners(connected)).resolves.toEqual({
        success: true,
        data: [
          {
            login: 'testuser',
            type: 'User',
            avatarUrl: 'https://avatars.githubusercontent.com/u/1',
          },
          {
            login: 'acme',
            type: 'Organization',
            avatarUrl: 'https://avatars.githubusercontent.com/u/2',
          },
        ],
      });
    });

    it('returns the user alone when organization listing fails', async () => {
      octokit.rest.orgs.listForAuthenticatedUser.mockRejectedValue(new Error('forbidden'));
      await expect(listOwners(connected)).resolves.toEqual({
        success: true,
        data: [
          {
            login: 'testuser',
            type: 'User',
            avatarUrl: 'https://avatars.githubusercontent.com/u/1',
          },
        ],
      });
    });

    it('keeps GitHub’s error message while typing the failure', async () => {
      octokit.rest.repos.createForAuthenticatedUser.mockRejectedValue(
        Object.assign(
          new Error('Repository creation failed.: name already exists on this account'),
          {
            status: 422,
          }
        )
      );
      await expect(
        createRepository(connected, { owner: 'testuser', name: 'dup', visibility: 'public' })
      ).resolves.toMatchObject({
        success: false,
        error: { message: 'Repository creation failed.: name already exists on this account' },
      });
    });

    it('maps API failures to integration errors', async () => {
      octokit.rest.users.getAuthenticated.mockRejectedValue(
        Object.assign(new Error('Bad credentials'), { status: 401 })
      );
      await expect(listOwners(connected)).resolves.toMatchObject({
        success: false,
        error: { type: 'auth_failed' },
      });
    });
  });

  describe('createRepository', () => {
    it('creates under the authenticated user', async () => {
      octokit.rest.repos.createForAuthenticatedUser.mockResolvedValue({ data: createdRepo });
      await expect(
        createRepository(connected, { owner: 'testuser', name: 'new', visibility: 'public' })
      ).resolves.toEqual({
        success: true,
        data: {
          repositoryUrl: 'https://github.com/testuser/new',
          cloneUrl: 'https://github.com/testuser/new.git',
          nameWithOwner: 'testuser/new',
          defaultBranch: 'main',
        },
      });
      expect(octokit.rest.repos.createForAuthenticatedUser).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'new', private: false, auto_init: true })
      );
    });

    it('creates in an organization when the owner is not the user', async () => {
      octokit.rest.repos.createInOrg.mockResolvedValue({ data: createdRepo });
      await createRepository(connected, { owner: 'acme', name: 'new', visibility: 'private' });
      expect(octokit.rest.repos.createInOrg).toHaveBeenCalledWith(
        expect.objectContaining({ org: 'acme', name: 'new', private: true, auto_init: true })
      );
    });

    it('creates an empty repository for publishing an existing branch', async () => {
      octokit.rest.repos.createForAuthenticatedUser.mockResolvedValue({ data: createdRepo });
      await createRepository(connected, {
        owner: 'testuser',
        name: 'new',
        visibility: 'private',
        initializeWithReadme: false,
      });
      expect(octokit.rest.repos.createForAuthenticatedUser).toHaveBeenCalledWith(
        expect.objectContaining({ auto_init: false })
      );
    });
  });

  it('deletes a repository', async () => {
    octokit.rest.repos.delete.mockResolvedValue({});
    await expect(deleteRepository(connected, { owner: 'testuser', name: 'old' })).resolves.toEqual({
      success: true,
      data: undefined,
    });
    expect(octokit.rest.repos.delete).toHaveBeenCalledWith({ owner: 'testuser', repo: 'old' });
  });

  describe('probeHost', () => {
    const host = { log } as unknown as IntegrationHostContext;
    const metaGet = vi.fn();
    const createOctokit = vi.fn(() => ({ rest: { meta: { get: metaGet } } }) as unknown as Octokit);

    it('probes the enterprise API base URL', async () => {
      metaGet.mockResolvedValue({ data: { verifiable_password_authentication: true } });
      await expect(probeHost(host, 'ghe.example.com', createOctokit)).resolves.toEqual({
        success: true,
        data: undefined,
      });
      expect(createOctokit).toHaveBeenCalledWith('https://ghe.example.com/api/v3');
    });

    it.each([401, 403])(
      'treats an authenticated-only meta response (%i) as GitHub',
      async (status) => {
        metaGet.mockRejectedValue({ status });
        await expect(probeHost(host, 'ghe.example.com', createOctokit)).resolves.toMatchObject({
          success: true,
        });
      }
    );

    it.each([404, 410])('reports other 4xx responses (%i) as not GitHub', async (status) => {
      metaGet.mockRejectedValue({ status });
      await expect(probeHost(host, 'gitlab.com', createOctokit)).resolves.toEqual({
        success: false,
        error: {
          type: 'unsupported_host',
          host: 'gitlab.com',
          message: `GitHub meta endpoint returned ${status}.`,
        },
      });
    });

    it.each([429, 408, 502])(
      'reports a %i response as a host error without a verdict',
      async (status) => {
        metaGet.mockRejectedValue({ status });
        await expect(probeHost(host, 'ghe.example.com', createOctokit)).resolves.toMatchObject({
          success: false,
          error: { type: 'host_error' },
        });
      }
    );

    it.each([404, 429, 502])(
      'treats a %i response carrying GitHub headers as GitHub',
      async (status) => {
        metaGet.mockRejectedValue({
          status,
          response: { headers: { 'x-github-request-id': 'F1DA:4F3EC:172CC35' } },
        });
        await expect(probeHost(host, 'ghe.example.com', createOctokit)).resolves.toMatchObject({
          success: true,
        });
      }
    );

    it('recognizes the GitHub Enterprise version header on a success response', async () => {
      metaGet.mockResolvedValue({
        data: 'not json',
        headers: { 'X-GitHub-Enterprise-Version': '3.16.2' },
      });
      await expect(probeHost(host, 'ghe.example.com', createOctokit)).resolves.toMatchObject({
        success: true,
      });
    });

    it('reports a GitLab answer as not GitHub', async () => {
      metaGet.mockRejectedValue({
        status: 410,
        response: { headers: { 'x-gitlab-meta': '{"correlation_id":"a","version":"1"}' } },
      });
      await expect(probeHost(host, 'gitlab.com', createOctokit)).resolves.toMatchObject({
        success: false,
        error: { type: 'unsupported_host' },
      });
    });

    it('distinguishes TLS failures from unreachable hosts', async () => {
      metaGet.mockRejectedValueOnce(new Error('self-signed certificate in chain'));
      await expect(probeHost(host, 'ghe.example.com', createOctokit)).resolves.toMatchObject({
        error: { type: 'host_error' },
      });
      metaGet.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND ghe.example.com'));
      await expect(probeHost(host, 'ghe.example.com', createOctokit)).resolves.toMatchObject({
        error: { type: 'host_unreachable' },
      });
    });
  });
});
