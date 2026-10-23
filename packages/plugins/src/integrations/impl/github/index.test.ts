import { noopLogger } from '@emdash/shared/logger';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FetchLike } from '../../helpers/oauth-device';
import { createGitHubAuthBehavior, GITHUB_OAUTH_CLIENT_ID, provider } from './index';

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
      credentials: {
        accessToken: 'gho_test',
        apiBaseUrl: 'https://api.github.com',
      },
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
      credentials: {
        accessToken: 'ghe_token',
        apiBaseUrl: 'https://ghe.example.com/api/v3',
      },
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://ghe.example.com/api/v3/user');
  });

  it('reports invalid tokens as not connected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, { message: 'Bad credentials' }))
    );

    const result = await auth.verify(host, { accessToken: 'gho_bad' });

    expect(result).toEqual({
      connected: false,
      error: 'GitHub authentication failed. Check your credentials.',
    });
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

describe('github device sign-in', () => {
  it('completes RFC 8628 device authorization against github.com', async () => {
    const fetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          device_code: 'device',
          user_code: 'WDJB-MJHT',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 0.001,
        })
      )
      .mockResolvedValueOnce(jsonResponse(200, { error: 'authorization_pending' }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'gho_device', scope: 'repo' }));

    const session = await createGitHubAuthBehavior({ fetch }).startDeviceAuthorization();
    if (!session.success) throw new Error('start failed');
    expect(session.data).toMatchObject({
      userCode: 'WDJB-MJHT',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 900,
    });
    await expect(session.data.complete(new AbortController().signal)).resolves.toEqual({
      success: true,
      data: { accessToken: 'gho_device', apiBaseUrl: 'https://api.github.com' },
    });

    const [codeUrl, codeInit] = fetch.mock.calls[0] as [string, RequestInit];
    expect(codeUrl).toBe('https://github.com/login/device/code');
    expect(new URLSearchParams(String(codeInit.body)).get('client_id')).toBe(
      GITHUB_OAUTH_CLIENT_ID
    );
    expect(fetch.mock.calls[1]?.[0]).toBe('https://github.com/login/oauth/access_token');
  });
});

describe('github server-issued tokens', () => {
  it('maps a token to credentials for the account host', () => {
    const behavior = createGitHubAuthBehavior();
    expect(
      behavior.credentialsFromOAuthToken({ accessToken: 'gho_server', host: 'github.com' })
    ).toEqual({ accessToken: 'gho_server', apiBaseUrl: 'https://api.github.com' });
    expect(
      behavior.credentialsFromOAuthToken({ accessToken: 'ghe', host: 'GHE.example.com' })
    ).toEqual({ accessToken: 'ghe', apiBaseUrl: 'https://ghe.example.com/api/v3' });
  });
});
