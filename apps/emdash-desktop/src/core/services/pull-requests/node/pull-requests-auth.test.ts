import { err, ok } from '@emdash/shared/result';
import { describe, expect, it, vi } from 'vitest';
import { createPullRequestsGitHubAuthController } from '@core/services/pull-requests/node/pull-requests-auth';

vi.mock('@main/core/github/services/github-api-auth-service-instance', () => ({
  githubApiAuthService: { getToken: vi.fn() },
}));

describe('pull requests GitHub auth controller', () => {
  it('resolves a normalized host, token, and API base URL', async () => {
    const getToken = vi.fn(async () => ok('secret-token'));
    const controller = createPullRequestsGitHubAuthController({ getToken });

    await expect(
      controller.call('resolveAuth', {
        host: 'GitHub.COM',
        accountId: 'account-1',
      })
    ).resolves.toEqual(
      ok({
        token: 'secret-token',
        host: 'github.com',
        apiBaseUrl: 'https://api.github.com',
      })
    );
    expect(getToken).toHaveBeenCalledWith('github.com', { accountId: 'account-1' });
  });

  it('preserves typed authentication failures', async () => {
    const error = {
      type: 'account_not_found' as const,
      host: 'github.example.com',
      accountId: 'missing',
      message: 'Account not found',
      hint: 'Reconnect the account',
    };
    const controller = createPullRequestsGitHubAuthController({
      getToken: vi.fn(async () => err(error)),
    });

    await expect(
      controller.call('resolveAuth', {
        host: 'github.example.com',
        accountId: 'missing',
      })
    ).resolves.toEqual(err(error));
  });
});
