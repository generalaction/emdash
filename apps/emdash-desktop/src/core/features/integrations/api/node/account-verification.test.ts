import { noopLogger } from '@emdash/shared/logger';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionStatus } from '@core/primitives/issue-providers/api';
import { checkIntegrationConnection } from './account-verification';

vi.mock('@gitbeaker/rest', () => ({
  Gitlab: class {
    Users = {
      showCurrentUser: async () => {
        throw Object.assign(new Error('401 Unauthorized'), {
          cause: { response: { status: 401 } },
        });
      },
    };
  },
}));

const capabilities = {} as ConnectionStatus['capabilities'];
const credentials = { instanceUrl: 'https://gitlab.com', accessToken: 'expired', expiresAt: 1 };

describe('checkIntegrationConnection', () => {
  it('explains failed credentials with the renewal error', async () => {
    const status = await checkIntegrationConnection(
      'gitlab',
      capabilities,
      noopLogger,
      async () => ({
        credentials,
        renewalError: 'Sign in to Emdash to keep GitLab connected.',
      })
    );

    expect(status).toMatchObject({
      connected: false,
      error: 'Sign in to Emdash to keep GitLab connected.',
    });
  });

  it('reports the provider error when renewal did not fail', async () => {
    const status = await checkIntegrationConnection(
      'gitlab',
      capabilities,
      noopLogger,
      async () => ({
        credentials,
      })
    );

    expect(status.connected).toBe(false);
    expect(status.error).toBeTruthy();
    expect(status.error).not.toContain('Emdash');
  });
});
