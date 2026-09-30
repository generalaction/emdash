import { err, ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearOctokitCache, getOctokit } from './octokit-provider';

const mockOctokit = vi.hoisted(() => vi.fn());

vi.mock('@octokit/rest', () => ({
  Octokit: mockOctokit,
}));

const mockGetCredentials = vi.fn();

describe('getOctokit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearOctokitCache();
    mockOctokit.mockImplementation(function (options) {
      return { options };
    });
  });

  it('uses api.github.com for github.com', async () => {
    mockGetCredentials.mockResolvedValue(
      ok({ accessToken: 'github-token', apiBaseUrl: 'https://api.github.com' })
    );

    await expect(getOctokit(mockGetCredentials, 'selected', 'github.com')).resolves.toMatchObject({
      success: true,
    });
    expect(mockOctokit).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: 'github-token',
        baseUrl: 'https://api.github.com',
        log: expect.objectContaining({ error: expect.any(Function) }),
      })
    );
  });

  it('passes the selected account ID to credential lookup', async () => {
    mockGetCredentials.mockResolvedValue(
      ok({ accessToken: 'selected-account-token', apiBaseUrl: 'https://api.github.com' })
    );

    await expect(
      getOctokit(mockGetCredentials, 'github.com:42', 'github.com')
    ).resolves.toMatchObject({
      success: true,
    });

    expect(mockGetCredentials).toHaveBeenCalledWith('github.com:42', 'github.com');
    expect(mockOctokit).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: 'selected-account-token',
      })
    );
  });

  it('caches separate GitHub.com clients for separate selected accounts', async () => {
    mockGetCredentials
      .mockResolvedValueOnce(ok({ accessToken: 'token-a', apiBaseUrl: 'https://api.github.com' }))
      .mockResolvedValueOnce(ok({ accessToken: 'token-b', apiBaseUrl: 'https://api.github.com' }))
      .mockResolvedValueOnce(ok({ accessToken: 'token-a', apiBaseUrl: 'https://api.github.com' }));

    await getOctokit(mockGetCredentials, 'github.com:42', 'github.com');
    await getOctokit(mockGetCredentials, 'github.com:84', 'github.com');
    await getOctokit(mockGetCredentials, 'github.com:42', 'github.com');

    expect(mockOctokit).toHaveBeenCalledTimes(2);
  });

  it('clears cached clients for one selected account without evicting other accounts', async () => {
    mockGetCredentials
      .mockResolvedValueOnce(ok({ accessToken: 'token-a', apiBaseUrl: 'https://api.github.com' }))
      .mockResolvedValueOnce(ok({ accessToken: 'token-b', apiBaseUrl: 'https://api.github.com' }))
      .mockResolvedValueOnce(ok({ accessToken: 'token-a', apiBaseUrl: 'https://api.github.com' }))
      .mockResolvedValueOnce(ok({ accessToken: 'token-b', apiBaseUrl: 'https://api.github.com' }));

    await getOctokit(mockGetCredentials, 'github.com:42', 'github.com');
    await getOctokit(mockGetCredentials, 'github.com:84', 'github.com');
    clearOctokitCache('github.com', 'github.com:42');
    await getOctokit(mockGetCredentials, 'github.com:42', 'github.com');
    await getOctokit(mockGetCredentials, 'github.com:84', 'github.com');

    expect(mockOctokit).toHaveBeenCalledTimes(3);
  });

  it('uses the enterprise API base URL for GHES hosts', async () => {
    mockGetCredentials.mockResolvedValue(
      ok({ accessToken: 'ghes-token', apiBaseUrl: 'https://ghe.example.com/api/v3' })
    );

    await expect(
      getOctokit(mockGetCredentials, 'selected', 'ghe.example.com')
    ).resolves.toMatchObject({
      success: true,
    });
    expect(mockOctokit).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: 'ghes-token',
        baseUrl: 'https://ghe.example.com/api/v3',
        log: expect.objectContaining({ error: expect.any(Function) }),
      })
    );
  });

  it('forwards typed auth errors', async () => {
    mockGetCredentials.mockResolvedValue(
      err({ type: 'auth_required', host: 'ghe.example.com', message: 'auth required' })
    );

    await expect(getOctokit(mockGetCredentials, 'selected', 'ghe.example.com')).resolves.toEqual({
      success: false,
      error: { type: 'auth_required', host: 'ghe.example.com', message: 'auth required' },
    });
    expect(mockOctokit).not.toHaveBeenCalled();
  });

  it('does not reuse a cached client when the selected credentials become unavailable', async () => {
    mockGetCredentials.mockResolvedValueOnce(
      ok({ accessToken: 'token', apiBaseUrl: 'https://api.github.com' })
    );
    await getOctokit(mockGetCredentials, 'selected', 'github.com');
    const error = {
      type: 'account_not_found',
      accountId: 'selected',
      host: 'github.com',
      message: 'Removed',
    };
    mockGetCredentials.mockResolvedValueOnce(err(error));
    await expect(getOctokit(mockGetCredentials, 'selected', 'github.com')).resolves.toEqual(
      err(error)
    );
    expect(mockOctokit).toHaveBeenCalledOnce();
  });

  it('rebuilds the client when stored connection config changes with the same token', async () => {
    mockGetCredentials
      .mockResolvedValueOnce(
        ok({ accessToken: 'token', apiBaseUrl: 'https://ghe.example.com/api/v3' })
      )
      .mockResolvedValueOnce(
        ok({ accessToken: 'token', apiBaseUrl: 'https://ghe.example.com/github/api/v3' })
      );
    await getOctokit(mockGetCredentials, 'ghe.example.com:42', 'ghe.example.com');
    await getOctokit(mockGetCredentials, 'ghe.example.com:42', 'ghe.example.com');
    expect(mockOctokit).toHaveBeenCalledTimes(2);
    expect(mockOctokit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        auth: 'token',
        baseUrl: 'https://ghe.example.com/github/api/v3',
      })
    );
  });
});
