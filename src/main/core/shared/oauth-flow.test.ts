import * as http from 'http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeOAuthFlow } from './oauth-flow';

const mockOpenExternal = vi.fn().mockResolvedValue(undefined);
vi.mock('electron', () => ({
  shell: { openExternal: (...args: unknown[]) => mockOpenExternal(...args) },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function httpGet(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        res.resume();
        res.on('end', resolve);
      })
      .on('error', reject);
  });
}

describe('executeOAuthFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens browser with PKCE params and exchanges code', async () => {
    const flowPromise = executeOAuthFlow({
      authorizeUrl: 'https://auth.test/sign-in',
      exchangeUrl: 'https://auth.test/api/exchange',
      successRedirectUrl: 'https://auth.test/auth/success',
      errorRedirectUrl: 'https://auth.test/auth/error',
      timeoutMs: 5000,
    });

    await vi.waitFor(() => expect(mockOpenExternal).toHaveBeenCalled());

    const openedUrl = new URL(mockOpenExternal.mock.calls[0][0]);
    expect(openedUrl.origin).toBe('https://auth.test');
    expect(openedUrl.pathname).toBe('/sign-in');
    expect(openedUrl.searchParams.has('state')).toBe(true);
    expect(openedUrl.searchParams.has('redirect_uri')).toBe(true);
    expect(openedUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(openedUrl.searchParams.has('code_challenge')).toBe(true);

    const mockResponse = { token: 'abc', user: { id: '1' } };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const redirectUri = openedUrl.searchParams.get('redirect_uri')!;
    const state = openedUrl.searchParams.get('state')!;
    await httpGet(`${redirectUri}?state=${encodeURIComponent(state)}&code=test-code`);

    const result = await flowPromise;
    expect(result).toEqual(mockResponse);
  });

  it('passes extra query params to authorize URL', async () => {
    const flowPromise = executeOAuthFlow({
      authorizeUrl: 'https://auth.test/authorize/github',
      exchangeUrl: 'https://auth.test/api/exchange',
      successRedirectUrl: 'https://auth.test/auth/success',
      errorRedirectUrl: 'https://auth.test/auth/error',
      extraParams: { provider: 'github', scope: 'repo' },
      timeoutMs: 5000,
    });

    await vi.waitFor(() => expect(mockOpenExternal).toHaveBeenCalled());

    const openedUrl = new URL(mockOpenExternal.mock.calls[0][0]);
    expect(openedUrl.searchParams.get('provider')).toBe('github');
    expect(openedUrl.searchParams.get('scope')).toBe('repo');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ accessToken: 'tok' }),
    });

    const redirectUri = openedUrl.searchParams.get('redirect_uri')!;
    const state = openedUrl.searchParams.get('state')!;
    await httpGet(`${redirectUri}?state=${encodeURIComponent(state)}&code=c`);

    await flowPromise;
  });

  it('rejects on state mismatch', async () => {
    const flowPromise = executeOAuthFlow({
      authorizeUrl: 'https://auth.test/sign-in',
      exchangeUrl: 'https://auth.test/api/exchange',
      successRedirectUrl: 'https://auth.test/auth/success',
      errorRedirectUrl: 'https://auth.test/auth/error',
      timeoutMs: 5000,
    });

    await vi.waitFor(() => expect(mockOpenExternal).toHaveBeenCalled());

    const openedUrl = new URL(mockOpenExternal.mock.calls[0][0]);
    const redirectUri = openedUrl.searchParams.get('redirect_uri')!;
    await httpGet(`${redirectUri}?state=wrong-state&code=test-code`);

    await expect(flowPromise).rejects.toThrow('State mismatch');
  });

  it('rejects on exchange failure', async () => {
    const flowPromise = executeOAuthFlow({
      authorizeUrl: 'https://auth.test/sign-in',
      exchangeUrl: 'https://auth.test/api/exchange',
      successRedirectUrl: 'https://auth.test/auth/success',
      errorRedirectUrl: 'https://auth.test/auth/error',
      timeoutMs: 5000,
    });

    await vi.waitFor(() => expect(mockOpenExternal).toHaveBeenCalled());

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'invalid code' }),
    });

    const openedUrl = new URL(mockOpenExternal.mock.calls[0][0]);
    const redirectUri = openedUrl.searchParams.get('redirect_uri')!;
    const state = openedUrl.searchParams.get('state')!;
    await httpGet(`${redirectUri}?state=${encodeURIComponent(state)}&code=c`);

    await expect(flowPromise).rejects.toThrow('invalid code');
  });
});
