import { createTestWire } from '@emdash/wire/testing';
import { expect, it, vi } from 'vitest';
import { integrationsContract } from '../api/contract';
import { createIntegrationsWireController } from './wire-controller';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(async () => ({ success: true, accountId: 'jira-account' })),
}));
vi.mock('./controller', () => ({ integrationOperations: { connect: mocks.connect } }));

it('carries form selection and reconnect identity through the Wire connection contract', async () => {
  const wire = createTestWire(integrationsContract, createIntegrationsWireController());
  const credentials = { siteUrl: 'https://example.atlassian.net', accessToken: 'oauth-token' };
  try {
    await expect(
      wire.client.connect({
        integrationId: 'jira',
        credentials,
        authMethodId: 'bearer',
        accountId: 'jira-account',
      })
    ).resolves.toEqual({ success: true, accountId: 'jira-account' });
    expect(mocks.connect).toHaveBeenCalledWith('jira', credentials, {
      authMethodId: 'bearer',
      accountId: 'jira-account',
      displayName: undefined,
    });
  } finally {
    await wire.dispose();
  }
});
