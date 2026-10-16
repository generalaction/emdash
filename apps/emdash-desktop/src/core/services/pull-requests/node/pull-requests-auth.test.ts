import { err, ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import { createPullRequestsAuthController } from '@core/services/pull-requests/node/pull-requests-auth';

function controllerWith(
  overrides: Partial<Parameters<typeof createPullRequestsAuthController>[0]>
) {
  return createPullRequestsAuthController({
    resolveIntegration: vi.fn(async () => ok({ integrationId: 'github' })),
    resolveSyncIdentity: vi.fn(async () => ok({ integrationId: 'github', accountId: 'account-1' })),
    readCredentials: vi.fn(async () =>
      ok({ accessToken: 'secret-token', apiBaseUrl: 'https://api.github.com' })
    ),
    ...overrides,
  });
}

describe('pull requests auth controller', () => {
  it('uses the selected account’s stored Enterprise endpoint', async () => {
    const controller = controllerWith({
      readCredentials: async () =>
        ok({
          accessToken: 'enterprise-token',
          apiBaseUrl: 'https://ghe.example.com/github/api/v3',
        }),
      resolveSyncIdentity: async () =>
        ok({ integrationId: 'github', accountId: 'ghe.example.com:42' }),
    });
    await expect(
      controller.call('resolveAuth', {
        integrationId: 'github',
        repositoryUrl: 'https://ghe.example.com/acme/repo',
      })
    ).resolves.toEqual(
      ok({
        integrationId: 'github',
        accountId: 'ghe.example.com:42',
        credentials: {
          accessToken: 'enterprise-token',
          apiBaseUrl: 'https://ghe.example.com/github/api/v3',
        },
      })
    );
  });

  it('resolves identity per request, then reads that integration’s credentials', async () => {
    const readCredentials = vi.fn(async () =>
      ok({ accessToken: 'secret-token', apiBaseUrl: 'https://api.github.com' })
    );
    const resolveSyncIdentity = vi.fn(async () =>
      ok({ integrationId: 'github', accountId: 'account-1' })
    );
    const controller = controllerWith({ readCredentials, resolveSyncIdentity });

    await expect(
      controller.call('resolveAuth', {
        integrationId: 'github',
        repositoryUrl: 'https://GitHub.COM/emdash/emdash',
      })
    ).resolves.toEqual(
      ok({
        integrationId: 'github',
        accountId: 'account-1',
        credentials: { accessToken: 'secret-token', apiBaseUrl: 'https://api.github.com' },
      })
    );
    expect(resolveSyncIdentity).toHaveBeenCalledWith('https://GitHub.COM/emdash/emdash', 'github');
    expect(readCredentials).toHaveBeenCalledWith('github', 'account-1', 'github.com');
  });

  it('returns the routed integration’s credential record unchanged', async () => {
    const controller = controllerWith({
      resolveSyncIdentity: async () => ok({ integrationId: 'gitlab', accountId: 'gl-1' }),
      readCredentials: async () => ok({ instanceUrl: 'https://gitlab.com', apiToken: 'glpat' }),
    });
    await expect(
      controller.call('resolveAuth', {
        integrationId: 'gitlab',
        repositoryUrl: 'https://gitlab.com/group/sub/project',
      })
    ).resolves.toEqual(
      ok({
        integrationId: 'gitlab',
        accountId: 'gl-1',
        credentials: { instanceUrl: 'https://gitlab.com', apiToken: 'glpat' },
      })
    );
  });

  it('fails closed when identity resolution fails, without reading credentials', async () => {
    const error = {
      type: 'account_unresolvable' as const,
      host: 'github.com',
      message: 'The pinned GitHub account no longer exists.',
    };
    const readCredentials = vi.fn(async () => ok({}));
    const controller = controllerWith({
      readCredentials,
      resolveSyncIdentity: vi.fn(async () => err(error)),
    });

    await expect(
      controller.call('resolveAuth', {
        integrationId: 'github',
        repositoryUrl: 'https://github.com/emdash/emdash',
      })
    ).resolves.toEqual(err(error));
    expect(readCredentials).not.toHaveBeenCalled();
  });

  it('preserves typed authentication failures', async () => {
    const error = {
      type: 'account_not_found' as const,
      host: 'github.example.com',
      accountId: 'missing',
      message: 'Account not found',
      hint: 'Reconnect the account',
    };
    const controller = controllerWith({ readCredentials: vi.fn(async () => err(error)) });

    await expect(
      controller.call('resolveAuth', {
        integrationId: 'github',
        repositoryUrl: 'https://github.example.com/emdash/emdash',
      })
    ).resolves.toEqual(err(error));
  });

  it('answers which integration serves a repository', async () => {
    const resolveIntegration = vi.fn(async () =>
      err({
        type: 'unsupported_provider' as const,
        host: 'git.example.com',
        reason: 'No connected integration handles git.example.com.',
      })
    );
    const controller = controllerWith({ resolveIntegration });

    await expect(
      controller.call('resolveIntegration', { repositoryUrl: 'https://git.example.com/a/b' })
    ).resolves.toEqual(
      err({
        type: 'unsupported_provider',
        host: 'git.example.com',
        reason: 'No connected integration handles git.example.com.',
      })
    );
    expect(resolveIntegration).toHaveBeenCalledWith('https://git.example.com/a/b');
  });
});
