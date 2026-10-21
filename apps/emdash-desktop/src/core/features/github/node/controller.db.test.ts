import type { Logger } from '@emdash/shared/logger';
import { openRegistryFixture, type RegistryFixture } from '@tooling/utils/provider-accounts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectGitHubAccount } from './accounts/github-auth-connection';
import { createGithubOperations } from './controller';
import { GitHubDeviceFlowService } from './services/github-device-flow-service';

describe('GitHub authentication shared connection lifecycle', () => {
  let fixture: RegistryFixture;
  const capture = vi.fn();
  const accountsChanged = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    fixture = await openRegistryFixture('empty', {
      telemetry: { capture },
      onAccountsChanged: accountsChanged,
    });
  });
  afterEach(() => fixture?.close());

  it.each(['device', 'cli'] as const)(
    'records one connection and inventory notification for %s authentication',
    async (method) => {
      const logger = { error: vi.fn(), warn: vi.fn() } as unknown as Logger;
      const connections = fixture.connections;
      const user = { id: 42, login: 'ada', name: 'Ada', email: '', avatar_url: '' };
      const operations = createGithubOperations({
        cliAccountImporter: {
          importAccounts: async () => [
            (
              await connectGitHubAccount(connections, {
                accessToken: 'test-token',
                credentialSource: 'cli',
                providerAccount: {
                  providerId: 'github',
                  providerAccountId: '42',
                  host: 'github.com',
                  login: user.login,
                  avatarUrl: user.avatar_url,
                },
              })
            ).account,
          ],
        },
        deviceFlowService: new GitHubDeviceFlowService({
          connections,
          identityClient: { getAuthenticatedUser: async () => user },
          publishEvent: vi.fn(),
          createDeviceAuth: () => async () => ({ token: 'test-token' }),
          config: { clientId: 'test-client', scopes: [] },
        }),
        logger,
        repositoryService: {} as never,
      });

      const result = await (method === 'device'
        ? operations.auth()
        : operations.importCliAccounts());

      expect(result.success).toBe(true);
      expect(await fixture.registry.listAccounts('github')).toHaveLength(1);
      expect(capture).toHaveBeenCalledExactlyOnceWith('integration_connected', {
        provider: 'github',
      });
      expect(accountsChanged).toHaveBeenCalledExactlyOnceWith('github');
    }
  );
});
