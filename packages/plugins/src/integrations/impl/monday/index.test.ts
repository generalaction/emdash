import type { Logger } from '@emdash/shared/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntegrationHostContext } from '../../host';
import { MONDAY_API_ERROR_MESSAGES } from './client';
import { provider } from './index';

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

const fetchMock = vi.fn();

const ME_RESPONSE = {
  data: { me: { id: '123', name: 'Snir', account: { name: 'My Team' } } },
};

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('monday integration verify', () => {
  it('validates the token against the Monday API and returns normalized credentials', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(ME_RESPONSE));

    const result = await auth.verify(host, {
      apiToken: 'valid-token',
      boardUrls: '',
    });

    expect(result).toEqual({
      connected: true,
      displayName: 'My Team',
      displayDetail: 'Snir',
      credentials: { apiToken: 'valid-token', boardIds: [], boardUrls: [] },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.monday.com/v2',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'valid-token' }),
      })
    );
  });

  it('parses and deduplicates board IDs from URLs', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(ME_RESPONSE));

    const result = await auth.verify(host, {
      apiToken: 'valid-token',
      boardUrls:
        'https://myteam.monday.com/boards/123456\nhttps://myteam.monday.com/boards/789012, https://myteam.monday.com/boards/123456',
    });

    expect(result).toEqual(
      expect.objectContaining({
        connected: true,
        credentials: {
          apiToken: 'valid-token',
          boardIds: ['123456', '789012'],
          boardUrls: [
            'https://myteam.monday.com/boards/123456',
            'https://myteam.monday.com/boards/789012',
          ],
        },
      })
    );
  });

  it('strips query parameters from board URLs', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(ME_RESPONSE));

    const result = await auth.verify(host, {
      apiToken: 'valid-token',
      boardUrls: 'https://myteam.monday.com/boards/123456?workspaceId=987654',
    });

    expect(result).toEqual(
      expect.objectContaining({
        connected: true,
        credentials: {
          apiToken: 'valid-token',
          boardIds: ['123456'],
          boardUrls: ['https://myteam.monday.com/boards/123456'],
        },
      })
    );
  });

  it('preserves previously resolved board scope when no board URL input is given', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(ME_RESPONSE));

    const result = await auth.verify(host, {
      apiToken: 'valid-token',
      boardIds: ['123456'],
      boardUrls: ['https://myteam.monday.com/boards/123456'],
    });

    expect(result).toEqual(
      expect.objectContaining({
        connected: true,
        credentials: {
          apiToken: 'valid-token',
          boardIds: ['123456'],
          boardUrls: ['https://myteam.monday.com/boards/123456'],
        },
      })
    );
  });

  it('returns an error for an invalid board URL format', async () => {
    const result = await auth.verify(host, {
      apiToken: 'valid-token',
      boardUrls: 'not-a-url',
    });

    expect(result).toEqual({
      connected: false,
      error: expect.stringContaining('Could not parse board ID'),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns an error for an empty token', async () => {
    const result = await auth.verify(host, { apiToken: '  ', boardUrls: '' });

    expect(result).toEqual({
      connected: false,
      error: 'Monday.com API token cannot be empty.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces the API error message when validation fails', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ errors: [{ message: 'Not Authenticated' }] }, false, 401)
    );

    const result = await auth.verify(host, {
      apiToken: 'bad-token',
      boardUrls: '',
    });

    expect(result).toEqual({ connected: false, error: 'Not Authenticated' });
  });

  it('returns a helpful authentication error when Monday rejects the token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 401));

    const result = await auth.verify(host, {
      apiToken: 'bad-token',
      boardUrls: '',
    });

    expect(result).toEqual({
      connected: false,
      error: MONDAY_API_ERROR_MESSAGES.AUTH_FAILED,
    });
  });
});
