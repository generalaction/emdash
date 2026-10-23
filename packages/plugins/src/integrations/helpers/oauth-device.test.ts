import { describe, expect, it, vi } from 'vitest';
import {
  pollDeviceToken,
  refreshOAuthToken,
  requestDeviceAuthorization,
  type DeviceAuthorization,
  type FetchLike,
} from './oauth-device';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sequence(...responses: Response[]): FetchLike & ReturnType<typeof vi.fn> {
  const fetch = vi.fn<FetchLike>();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  return fetch as FetchLike & ReturnType<typeof vi.fn>;
}

const authorization: DeviceAuthorization = {
  deviceCode: 'device',
  userCode: 'N03SDJ4B',
  verificationUri: 'https://gitlab.com/oauth/device',
  expiresIn: 300,
  interval: 5,
};

function poll(fetch: FetchLike, overrides: { now?: () => number; signal?: AbortSignal } = {}) {
  const sleep = vi.fn(async (_ms: number, _signal: AbortSignal) => {});
  return {
    sleep,
    result: pollDeviceToken({
      url: 'https://gitlab.com/oauth/token',
      clientId: 'client',
      authorization,
      provider: 'GitLab',
      signal: overrides.signal ?? new AbortController().signal,
      fetch,
      now: overrides.now ?? (() => 1_000),
      sleep,
    }),
  };
}

describe('requestDeviceAuthorization', () => {
  it('posts the client id and space-joined scopes and maps the response', async () => {
    const fetch = sequence(
      json(200, {
        device_code: 'device',
        user_code: 'N03SDJ4B',
        verification_uri: 'https://gitlab.com/oauth/device',
        verification_uri_complete: 'https://gitlab.com/oauth/device?user_code=N03SDJ4B',
        expires_in: 300,
        interval: 5,
      })
    );
    await expect(
      requestDeviceAuthorization({
        url: 'https://gitlab.com/oauth/authorize_device',
        clientId: 'client',
        scopes: ['api', 'read_user'],
        provider: 'GitLab',
        fetch,
      })
    ).resolves.toEqual({
      success: true,
      data: {
        ...authorization,
        verificationUriComplete: 'https://gitlab.com/oauth/device?user_code=N03SDJ4B',
      },
    });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://gitlab.com/oauth/authorize_device');
    expect(new URLSearchParams(String(init.body)).get('scope')).toBe('api read_user');
    expect(new URLSearchParams(String(init.body)).get('client_id')).toBe('client');
  });

  it('surfaces the OAuth error description', async () => {
    const fetch = sequence(
      json(400, {
        error: 'invalid_scope',
        error_description: 'The requested scope is invalid, unknown, or malformed.',
      })
    );
    await expect(
      requestDeviceAuthorization({
        url: 'https://gitlab.com/oauth/authorize_device',
        clientId: 'client',
        scopes: ['api'],
        provider: 'GitLab',
        fetch,
      })
    ).resolves.toEqual({
      success: false,
      error: {
        type: 'generic',
        message: 'GitLab: The requested scope is invalid, unknown, or malformed.',
      },
    });
  });
});

describe('pollDeviceToken', () => {
  it('keeps polling while authorization is pending, then returns tokens', async () => {
    const fetch = sequence(
      json(400, { error: 'authorization_pending' }),
      json(200, { access_token: 'access', refresh_token: 'refresh', expires_in: 7200 })
    );
    const { result, sleep } = poll(fetch);
    await expect(result).resolves.toEqual({
      success: true,
      data: { accessToken: 'access', refreshToken: 'refresh', expiresAt: 1_000 + 7_200_000 },
    });
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([5000, 5000]);
    const body = new URLSearchParams(
      String((fetch.mock.calls[0] as [string, RequestInit])[1].body)
    );
    expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code');
    expect(body.get('device_code')).toBe('device');
  });

  it('adds five seconds to the interval on slow_down', async () => {
    const fetch = sequence(
      json(400, { error: 'slow_down' }),
      json(200, { access_token: 'access', refresh_token: 'refresh', expires_in: 7200 })
    );
    const { result, sleep } = poll(fetch);
    await result;
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([5000, 10000]);
  });

  it.each([
    ['access_denied', 'GitLab sign-in was denied.'],
    ['expired_token', 'The GitLab sign-in code expired. Try again.'],
  ])('stops on %s', async (error, message) => {
    const { result } = poll(sequence(json(400, { error })));
    await expect(result).resolves.toEqual({
      success: false,
      error: { type: 'auth_failed', message },
    });
  });

  it('stops without a request once the code has expired locally', async () => {
    const fetch = sequence();
    let now = 0;
    const { result } = poll(fetch, { now: () => (now += 400_000) });
    await expect(result).resolves.toMatchObject({ success: false, error: { type: 'auth_failed' } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps polling through network failures and 5xx responses', async () => {
    const fetch = vi
      .fn<FetchLike>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('<html>Bad Gateway</html>', { status: 502 }))
      .mockResolvedValueOnce(
        json(200, { access_token: 'access', refresh_token: 'refresh', expires_in: 7200 })
      );
    const { result } = poll(fetch);
    await expect(result).resolves.toMatchObject({ success: true });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('stops on an unrecognized OAuth error', async () => {
    const { result } = poll(sequence(json(400, { error: 'invalid_client' })));
    await expect(result).resolves.toMatchObject({ success: false, error: { type: 'generic' } });
  });

  it('stops when cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = sequence();
    const { result } = poll(fetch, { signal: controller.signal });
    await expect(result).resolves.toMatchObject({ success: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('refreshOAuthToken', () => {
  function refresh(fetch: FetchLike) {
    return refreshOAuthToken({
      url: 'https://gitlab.com/oauth/token',
      clientId: 'client',
      refreshToken: 'old-refresh',
      provider: 'GitLab',
      fetch,
      now: () => 5_000,
    });
  }

  it('exchanges the refresh token for a new pair', async () => {
    const fetch = sequence(
      json(200, { access_token: 'new', refresh_token: 'new-refresh', expires_in: 7200 })
    );
    await expect(refresh(fetch)).resolves.toEqual({
      success: true,
      data: { accessToken: 'new', refreshToken: 'new-refresh', expiresAt: 5_000 + 7_200_000 },
    });
    const body = new URLSearchParams(
      String((fetch.mock.calls[0] as [string, RequestInit])[1].body)
    );
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('old-refresh');
  });

  it('reports a revoked or reused refresh token as an auth failure', async () => {
    await expect(refresh(sequence(json(400, { error: 'invalid_grant' })))).resolves.toEqual({
      success: false,
      error: { type: 'auth_failed', message: 'GitLab sign-in expired. Reconnect your account.' },
    });
  });

  it('reports a network failure without an auth verdict', async () => {
    const fetch = vi.fn<FetchLike>().mockRejectedValue(new TypeError('fetch failed'));
    await expect(refresh(fetch)).resolves.toMatchObject({
      success: false,
      error: { type: 'host_unreachable' },
    });
  });

  it('bounds the request with a timeout', async () => {
    const fetch = sequence(json(200, { access_token: 'a', refresh_token: 'r', expires_in: 7200 }));
    await refresh(fetch);
    expect((fetch.mock.calls[0] as [string, RequestInit])[1].signal).toBeInstanceOf(AbortSignal);
  });

  it('reports a timed-out request as unreachable', async () => {
    const fetch = vi
      .fn<FetchLike>()
      .mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));
    await expect(refresh(fetch)).resolves.toMatchObject({
      success: false,
      error: { type: 'host_unreachable' },
    });
  });
});
