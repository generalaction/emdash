import type { Logger } from '@emdash/shared/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntegrationHostContext } from '../../host';
import { TRELLO_API_ERROR_MESSAGES } from './client';
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
if (!auth) throw new Error('Trello auth behavior is not registered.');

const host: IntegrationHostContext = { log: logger };

const MEMBER = { id: 'member-1', fullName: 'Jan', username: 'jan' };

const fetchMock = vi.fn();

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function errorResponse(status: number, body = '') {
  return { ok: false, status, text: async () => body };
}

/** Route responses by pathname since board resolution runs concurrently. */
function routeFetch(routes: Record<string, unknown>) {
  fetchMock.mockImplementation(async (input: URL) => {
    const response = routes[input.pathname];
    if (response === undefined) throw new Error(`Unexpected request: ${input.pathname}`);
    return response;
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('trello integration verify', () => {
  it('validates credentials against the Trello API and returns normalized credentials', async () => {
    routeFetch({ '/1/members/me': jsonResponse(MEMBER) });

    const result = await auth.verify(host, {
      apiKey: 'key',
      apiToken: 'valid-token',
      boardUrls: '',
    });

    expect(result).toEqual({
      connected: true,
      displayName: 'Jan',
      displayDetail: '@jan',
      credentials: { apiKey: 'key', apiToken: 'valid-token', boardIds: [] },
    });
  });

  it('sends the key and token as query parameters', async () => {
    routeFetch({ '/1/members/me': jsonResponse(MEMBER) });

    await auth.verify(host, { apiKey: 'key', apiToken: 'tok', boardUrls: '' });

    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.pathname).toBe('/1/members/me');
    expect(url.searchParams.get('key')).toBe('key');
    expect(url.searchParams.get('token')).toBe('tok');
  });

  it('resolves and deduplicates board IDs from URLs', async () => {
    routeFetch({
      '/1/members/me': jsonResponse(MEMBER),
      '/1/boards/aBcD1234': jsonResponse({ id: 'board-abc' }),
      '/1/boards/eFgH5678': jsonResponse({ id: 'board-def' }),
    });

    const result = await auth.verify(host, {
      apiKey: 'key',
      apiToken: 'valid-token',
      boardUrls:
        'https://trello.com/b/aBcD1234/my-board\nhttps://trello.com/b/eFgH5678, https://trello.com/b/aBcD1234',
    });

    expect(result).toEqual(
      expect.objectContaining({
        connected: true,
        credentials: {
          apiKey: 'key',
          apiToken: 'valid-token',
          boardIds: ['board-abc', 'board-def'],
        },
      })
    );
  });

  it('preserves previously resolved board IDs when no board URL input is given', async () => {
    routeFetch({ '/1/members/me': jsonResponse(MEMBER) });

    const result = await auth.verify(host, {
      apiKey: 'key',
      apiToken: 'valid-token',
      boardIds: ['board-abc'],
    });

    expect(result).toEqual(
      expect.objectContaining({
        connected: true,
        credentials: { apiKey: 'key', apiToken: 'valid-token', boardIds: ['board-abc'] },
      })
    );
  });

  it('returns an error for an invalid board URL format', async () => {
    const result = await auth.verify(host, {
      apiKey: 'key',
      apiToken: 'valid-token',
      boardUrls: 'not-a-url',
    });

    expect(result).toEqual({
      connected: false,
      error: expect.stringContaining('Could not parse board ID'),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns an error when too many boards are configured', async () => {
    const boardUrls = Array.from(
      { length: 21 },
      (_, index) => `https://trello.com/b/board${index}`
    ).join('\n');

    const result = await auth.verify(host, {
      apiKey: 'key',
      apiToken: 'valid-token',
      boardUrls,
    });

    expect(result).toEqual({
      connected: false,
      error: expect.stringContaining('limited to 20 boards'),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns an error for an empty API key or token', async () => {
    const result = await auth.verify(host, {
      apiKey: '  ',
      apiToken: 'tok',
      boardUrls: '',
    });

    expect(result).toEqual({
      connected: false,
      error: 'Trello API key and token cannot be empty.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns an error for inaccessible boards', async () => {
    routeFetch({
      '/1/members/me': jsonResponse(MEMBER),
      '/1/boards/aBcD1234': errorResponse(404, 'board not found'),
    });

    const result = await auth.verify(host, {
      apiKey: 'key',
      apiToken: 'valid-token',
      boardUrls: 'https://trello.com/b/aBcD1234',
    });

    expect(result).toEqual({
      connected: false,
      error: expect.stringContaining('Could not access Trello board "aBcD1234"'),
    });
  });

  it('returns a helpful authentication error when Trello rejects the credentials', async () => {
    routeFetch({ '/1/members/me': errorResponse(401, 'invalid token') });

    const result = await auth.verify(host, {
      apiKey: 'key',
      apiToken: 'bad-token',
      boardUrls: '',
    });

    expect(result).toEqual({
      connected: false,
      error: TRELLO_API_ERROR_MESSAGES.AUTH_FAILED,
    });
  });
});
