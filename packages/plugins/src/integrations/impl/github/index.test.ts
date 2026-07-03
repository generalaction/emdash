import { noopLogger, type Logger } from '@emdash/shared/logger';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { provider } from './index';

const auth = provider.behavior.auth;
if (!auth) throw new Error('GitHub integration plugin has no auth behavior');

const host = { log: noopLogger };

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

describe('github integration verify', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('verifies a github.com token and returns the account identity', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: 42,
        login: 'monalisa',
        avatar_url: 'https://avatars.example.com/u/42',
        name: 'Mona Lisa',
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await auth.verify(host, { accessToken: 'gho_test' });

    expect(result).toEqual({
      connected: true,
      account: {
        id: '42',
        login: 'monalisa',
        avatarUrl: 'https://avatars.example.com/u/42',
        host: 'github.com',
      },
      displayName: 'Mona Lisa',
    });
    const requestUrl = fetchMock.mock.calls[0]?.[0] as string;
    const options = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(requestUrl).toBe('https://api.github.com/user');
    expect(options.headers.authorization).toBe('token gho_test');
  });

  it('derives the GHES host and falls back to the login for the display name', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { id: 7, login: 'hubot', name: null }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await auth.verify(host, {
      accessToken: 'ghe_token',
      apiBaseUrl: 'https://ghe.example.com/api/v3',
    });

    expect(result).toEqual({
      connected: true,
      account: { id: '7', login: 'hubot', host: 'ghe.example.com' },
      displayName: 'hubot',
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://ghe.example.com/api/v3/user');
  });

  it('reports invalid tokens as not connected and warns through the host log', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, { message: 'Bad credentials' }))
    );
    const log: Logger = { ...noopLogger, warn: vi.fn() };

    const result = await auth.verify({ log }, { accessToken: 'gho_bad' });

    expect(result).toEqual({ connected: false, error: 'Bad credentials' });
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('GitHub credential verification failed')
    );
  });

  it('rejects a missing access token without making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await auth.verify(host, {});

    expect(result).toEqual({
      connected: false,
      error: 'GitHub access token is required.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
