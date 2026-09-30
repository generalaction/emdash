import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setProviderAccountService,
  type ProviderAccountService,
} from '@core/services/provider-accounts/node/provider-account-service';

const { connect } = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('./integration-connection-service', () => ({
  getIntegrationConnectionService: () => ({ connect }),
}));
vi.mock('@emdash/plugins/integrations', () => ({
  integrationPluginRegistry: {
    getAll: () => [{ metadata: { id: 'github' } }, { metadata: { id: 'jira' } }],
    get: (id: string) => ({
      capabilities: { auth: { methods: [{ kind: id === 'github' ? 'oauth' : 'form' }] } },
    }),
  },
}));

import { integrationOperations } from './controller';

describe('integrationOperations shared account lifecycle', () => {
  const accounts = {
    listAccounts: vi.fn(),
    setDefaultAccount: vi.fn(),
    removeAccount: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setProviderAccountService(accounts as unknown as ProviderAccountService);
    accounts.listAccounts.mockResolvedValue([]);
  });

  it.each(['github', 'jira'])('uses the same lifecycle for %s', async (providerId) => {
    accounts.setDefaultAccount.mockResolvedValueOnce(null);
    await expect(integrationOperations.setDefaultAccount(providerId, 'missing')).resolves.toEqual({
      success: false,
      error: 'Account not found.',
    });
    accounts.setDefaultAccount.mockResolvedValueOnce({ accountId: 'a' });
    await expect(integrationOperations.setDefaultAccount(providerId, 'a')).resolves.toEqual({
      success: true,
    });
    await integrationOperations.disconnect(providerId, 'a');
    expect(accounts.removeAccount).toHaveBeenCalledWith(providerId, 'a');
  });

  it('keeps provider authentication flows outside generic form credential storage', async () => {
    expect((await integrationOperations.connect('github', { token: 'x' })).success).toBe(false);
    expect(connect).not.toHaveBeenCalled();
    await integrationOperations.connect('jira', { apiToken: 'x' }, { accountId: 'saved' });
    expect(connect).toHaveBeenCalledWith('jira', { apiToken: 'x' }, { accountId: 'saved' });
  });
});
