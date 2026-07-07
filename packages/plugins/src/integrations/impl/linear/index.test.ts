import type { Logger } from '@emdash/shared/logger';
import type * as LinearSdk from '@linear/sdk';
import { AuthenticationLinearError } from '@linear/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IntegrationHostContext } from '../../host';
import { provider } from './index';

const linearSdk = vi.hoisted(() => ({
  constructor: vi.fn(),
  viewer: vi.fn(),
}));

vi.mock('@linear/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof LinearSdk>();
  return {
    ...actual,
    LinearClient: class {
      constructor(config: unknown) {
        linearSdk.constructor(config);
      }

      get viewer() {
        return linearSdk.viewer();
      }
    },
  };
});

const logger: Logger = {
  level: 'error',
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => logger,
};

const auth = provider.behavior.auth;
if (!auth) throw new Error('Linear auth behavior is not registered.');

const host: IntegrationHostContext = { log: logger };

afterEach(() => {
  linearSdk.constructor.mockReset();
  linearSdk.viewer.mockReset();
});

describe('linear integration verify', () => {
  it('validates the API key against the Linear API and returns normalized credentials', async () => {
    linearSdk.viewer.mockResolvedValueOnce({
      displayName: 'Jona',
      name: 'jona',
      organization: Promise.resolve({ name: 'Acme Inc' }),
    });

    const result = await auth.verify(host, { apiKey: 'lin_api_test' });

    expect(result).toEqual({
      connected: true,
      displayName: 'Jona',
      displayDetail: 'Acme Inc',
      credentials: { apiKey: 'lin_api_test' },
    });
    expect(linearSdk.constructor).toHaveBeenCalledWith({ apiKey: 'lin_api_test' });
  });

  it('returns an error for an empty API key', async () => {
    const result = await auth.verify(host, { apiKey: '  ' });

    expect(result).toEqual({
      connected: false,
      error: 'Linear API key is required.',
    });
    expect(linearSdk.constructor).not.toHaveBeenCalled();
  });

  it('surfaces the API error message when Linear rejects the key', async () => {
    linearSdk.viewer.mockRejectedValueOnce(
      new AuthenticationLinearError({ message: 'Authentication required' })
    );

    const result = await auth.verify(host, { apiKey: 'bad-key' });

    expect(result).toEqual({ connected: false, error: 'Authentication required' });
  });
});
