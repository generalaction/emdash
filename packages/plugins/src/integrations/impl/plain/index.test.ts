import type { Logger } from '@emdash/shared/logger';
import type * as PlainSdk from '@team-plain/graphql';
import { AuthenticationError } from '@team-plain/graphql';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IntegrationHostContext } from '../../host';
import { provider } from './index';

const plainSdk = vi.hoisted(() => ({
  constructor: vi.fn(),
  threads: vi.fn(),
}));

vi.mock('@team-plain/graphql', async (importOriginal) => {
  const actual = await importOriginal<typeof PlainSdk>();
  return {
    ...actual,
    PlainClient: class {
      query = { threads: plainSdk.threads };

      constructor(config: unknown) {
        plainSdk.constructor(config);
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
if (!auth) throw new Error('Plain auth behavior is not registered.');

const host: IntegrationHostContext = { log: logger };

afterEach(() => {
  plainSdk.constructor.mockReset();
  plainSdk.threads.mockReset();
});

describe('plain integration verify', () => {
  it('validates the API key against threads and returns normalized credentials', async () => {
    plainSdk.threads.mockResolvedValueOnce({ nodes: [] });

    const result = await auth.verify(host, { apiKey: 'plain_api_key' });

    expect(result).toEqual({
      connected: true,
      credentials: { apiKey: 'plain_api_key' },
    });
    expect(plainSdk.constructor).toHaveBeenCalledWith({ apiKey: 'plain_api_key' });
    expect(plainSdk.threads).toHaveBeenCalledWith({ first: 1 });
  });

  it('returns an error for an empty API key', async () => {
    const result = await auth.verify(host, { apiKey: '  ' });

    expect(result).toEqual({
      connected: false,
      error: 'Plain API key cannot be empty.',
    });
    expect(plainSdk.constructor).not.toHaveBeenCalled();
  });

  it('surfaces the API error message when Plain rejects the key', async () => {
    plainSdk.threads.mockRejectedValueOnce(
      new AuthenticationError('Authentication error: invalid API key')
    );

    const result = await auth.verify(host, { apiKey: 'bad-key' });

    expect(result).toEqual({
      connected: false,
      error: 'Authentication error: invalid API key',
    });
  });
});
