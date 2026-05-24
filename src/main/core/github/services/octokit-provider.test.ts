import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@shared/result';
import { githubApiAuthService } from './github-api-auth-service';
import { clearOctokitCache, getOctokit } from './octokit-provider';

const mockOctokit = vi.hoisted(() => vi.fn());

vi.mock('@octokit/rest', () => ({
  Octokit: mockOctokit,
}));

vi.mock('./github-api-auth-service', () => ({
  githubApiAuthService: {
    getToken: vi.fn(),
  },
}));

const mockGetToken = vi.mocked(githubApiAuthService.getToken);

describe('getOctokit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearOctokitCache();
    mockOctokit.mockImplementation(function (options) {
      return { options };
    });
  });

  it('uses api.github.com for github.com', async () => {
    mockGetToken.mockResolvedValue(ok('github-token'));

    await expect(getOctokit('github.com')).resolves.toEqual({
      success: true,
      data: { options: { auth: 'github-token', baseUrl: 'https://api.github.com' } },
    });
  });

  it('uses the enterprise API base URL for GHES hosts', async () => {
    mockGetToken.mockResolvedValue(ok('ghes-token'));

    await expect(getOctokit('ghe.example.com')).resolves.toEqual({
      success: true,
      data: { options: { auth: 'ghes-token', baseUrl: 'https://ghe.example.com/api/v3' } },
    });
  });

  it('forwards typed auth errors', async () => {
    mockGetToken.mockResolvedValue(
      err({ type: 'auth_required', host: 'ghe.example.com', message: 'auth required' })
    );

    await expect(getOctokit('ghe.example.com')).resolves.toEqual({
      success: false,
      error: { type: 'auth_required', host: 'ghe.example.com', message: 'auth required' },
    });
  });
});
