import type { Logger } from '@emdash/shared/logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntegrationHostContext } from '../../host';
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
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => body,
  };
}

function errorResponse(status: number, body = '') {
  return {
    ok: false,
    status,
    statusText: '',
    headers: { get: () => 'text/plain' },
    text: async () => body,
  };
}

function routeFetch(routes: Record<string, unknown>) {
  fetchMock.mockImplementation(async (input: string | URL) => {
    const url = new URL(String(input));
    const response = routes[url.pathname];
    if (response === undefined) throw new Error(`Unexpected request: ${url.pathname}`);
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
    });

    expect(result).toEqual({
      connected: true,
      displayName: 'Jan',
      displayDetail: '@jan',
      credentials: { apiKey: 'key', apiToken: 'valid-token' },
    });
  });

  it('sends the key and token as query parameters', async () => {
    routeFetch({ '/1/members/me': jsonResponse(MEMBER) });

    await auth.verify(host, { apiKey: 'key', apiToken: 'tok' });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/1/members/me');
    expect(url.searchParams.get('key')).toBe('key');
    expect(url.searchParams.get('token')).toBe('tok');
  });

  it('ignores stale board scope fields from older credentials', async () => {
    routeFetch({ '/1/members/me': jsonResponse(MEMBER) });

    const result = await auth.verify(host, {
      apiKey: 'key',
      apiToken: 'valid-token',
      boardIds: ['board-abc'],
      boardUrls: 'https://trello.com/b/old-scope',
    });

    expect(result).toEqual({
      connected: true,
      displayName: 'Jan',
      displayDetail: '@jan',
      credentials: { apiKey: 'key', apiToken: 'valid-token' },
    });
  });

  it('returns an error for an empty API key or token', async () => {
    const result = await auth.verify(host, {
      apiKey: '  ',
      apiToken: 'tok',
    });

    expect(result).toEqual({
      connected: false,
      error: 'Trello API key and token cannot be empty.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a helpful authentication error when Trello rejects the credentials', async () => {
    routeFetch({ '/1/members/me': errorResponse(401, 'invalid token') });

    const result = await auth.verify(host, {
      apiKey: 'key',
      apiToken: 'bad-token',
    });

    expect(result).toEqual({
      connected: false,
      error: 'Trello request failed.',
    });
  });
});
