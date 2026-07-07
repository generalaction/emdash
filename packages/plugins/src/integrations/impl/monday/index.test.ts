import type { Logger } from '@emdash/shared/logger';
import { ClientError } from '@mondaydotcomorg/api';
import { GraphQLError } from 'graphql';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IntegrationHostContext } from '../../host';
import { MONDAY_API_ERROR_MESSAGES } from './error';
import { provider } from './index';

const mondaySdk = vi.hoisted(() => ({
  constructor: vi.fn(),
  request: vi.fn(),
}));

vi.mock('@mondaydotcomorg/api', () => ({
  ApiClient: class {
    request = mondaySdk.request;

    constructor(config: unknown) {
      mondaySdk.constructor(config);
    }
  },
  ClientError: class extends Error {
    response: { status: number; errors?: Array<{ message?: string }> };

    constructor(response: { status: number; errors?: Array<{ message?: string }> }) {
      super(response.errors?.[0]?.message ?? '');
      this.response = response;
    }
  },
}));

const logger: Logger = {
  level: 'error',
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => logger,
};

const auth = provider.behavior.auth;
if (!auth) throw new Error('Monday auth behavior is not registered.');

const host: IntegrationHostContext = { log: logger };

const ME_RESPONSE = {
  me: { id: '123', name: 'Snir', account: { name: 'My Team' } },
};

afterEach(() => {
  mondaySdk.constructor.mockReset();
  mondaySdk.request.mockReset();
});

describe('monday integration verify', () => {
  it('validates the token against the Monday API and returns normalized credentials', async () => {
    mondaySdk.request.mockResolvedValueOnce(ME_RESPONSE);

    const result = await auth.verify(host, {
      apiToken: 'valid-token',
    });

    expect(result).toEqual({
      connected: true,
      displayName: 'My Team',
      displayDetail: 'Snir',
      credentials: { apiToken: 'valid-token' },
    });
    expect(mondaySdk.constructor).toHaveBeenCalledWith({ token: 'valid-token' });
    expect(mondaySdk.request).toHaveBeenCalledWith('query { me { id name account { name } } }');
  });

  it('ignores stale board scope fields from older credentials', async () => {
    mondaySdk.request.mockResolvedValueOnce(ME_RESPONSE);

    const result = await auth.verify(host, {
      apiToken: 'valid-token',
      boardIds: ['123456'],
      boardUrls: 'https://myteam.monday.com/boards/123456',
    });

    expect(result).toEqual(
      expect.objectContaining({
        connected: true,
        credentials: { apiToken: 'valid-token' },
      })
    );
  });

  it('returns an error for an empty token', async () => {
    const result = await auth.verify(host, { apiToken: '  ' });

    expect(result).toEqual({
      connected: false,
      error: 'Monday.com API token cannot be empty.',
    });
    expect(mondaySdk.request).not.toHaveBeenCalled();
  });

  it('surfaces the API error message for unclassified failures', async () => {
    mondaySdk.request.mockRejectedValueOnce(clientError(400, 'Some field is invalid'));

    const result = await auth.verify(host, {
      apiToken: 'bad-token',
    });

    expect(result).toEqual({ connected: false, error: 'Some field is invalid' });
  });

  it('returns a helpful authentication error when Monday rejects the token', async () => {
    mondaySdk.request.mockRejectedValueOnce(clientError(401));

    const result = await auth.verify(host, {
      apiToken: 'bad-token',
    });

    expect(result).toEqual({
      connected: false,
      error: MONDAY_API_ERROR_MESSAGES.AUTH_FAILED,
    });
  });
});

function clientError(status: number, message?: string): ClientError {
  return new ClientError(
    { status, errors: message ? [new GraphQLError(message)] : [] },
    { query: '' }
  );
}
