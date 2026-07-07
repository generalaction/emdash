import type { Logger } from '@emdash/shared/logger';
import { APIErrorCode, APIResponseError } from '@notionhq/client';
import type * as NotionSdk from '@notionhq/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IntegrationHostContext } from '../../host';
import { provider } from './index';

const notionSdk = vi.hoisted(() => ({
  constructor: vi.fn(),
  me: vi.fn(),
}));

vi.mock('@notionhq/client', async (importOriginal) => {
  const actual = await importOriginal<typeof NotionSdk>();
  return {
    ...actual,
    Client: class {
      constructor(config: unknown) {
        notionSdk.constructor(config);
      }

      users = {
        me: notionSdk.me,
      };
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
if (!auth) throw new Error('Notion auth behavior is not registered.');

const host: IntegrationHostContext = { log: logger };

afterEach(() => {
  notionSdk.constructor.mockReset();
  notionSdk.me.mockReset();
});

describe('notion integration verify', () => {
  it('validates the integration token and returns normalized credentials', async () => {
    notionSdk.me.mockResolvedValueOnce({
      object: 'user',
      id: 'bot-1',
      type: 'bot',
      name: 'Emdash',
      avatar_url: null,
      bot: {},
    });

    const result = await auth.verify(host, { apiToken: ' ntn_valid ' });

    expect(result).toEqual({
      connected: true,
      displayName: 'Emdash',
      credentials: { apiToken: 'ntn_valid' },
    });
    expect(notionSdk.constructor).toHaveBeenCalledWith({ auth: 'ntn_valid' });
    expect(notionSdk.me).toHaveBeenCalledWith({});
  });

  it('returns an error for an empty token', async () => {
    const result = await auth.verify(host, { apiToken: '  ' });

    expect(result).toEqual({
      connected: false,
      error: 'Notion integration token is required.',
    });
    expect(notionSdk.constructor).not.toHaveBeenCalled();
  });

  it('maps Notion unauthorized errors to a helpful auth message', async () => {
    notionSdk.me.mockRejectedValueOnce(
      new APIResponseError({
        code: APIErrorCode.Unauthorized,
        status: 401,
        message: 'API token is invalid.',
        headers: new Headers(),
        rawBodyText: '{}',
        additional_data: undefined,
        request_id: undefined,
      })
    );

    const result = await auth.verify(host, { apiToken: 'bad-token' });

    expect(result).toEqual({
      connected: false,
      error: 'Notion authentication failed. Check your integration token.',
    });
  });
});
