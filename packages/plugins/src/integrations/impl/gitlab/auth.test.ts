import { describe, expect, it, vi } from 'vitest';
import type { FetchLike } from '../../helpers/oauth-device';
import type { IntegrationHostContext } from '../../host';
import { gitLabAuthHeaders, gitLabGitCredential } from './client';
import {
  createGitLabAuthBehavior,
  GITLAB_OAUTH_CLIENT_ID,
  GITLAB_REFRESH_SKEW_MS,
  provider,
} from './index';
import { gitLabCredentialsSchema } from './types';

const host = {
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
} as unknown as IntegrationHostContext;
const pat = { instanceUrl: 'https://gitlab.example.com', apiToken: 'glpat-x' };
const oauth = {
  instanceUrl: 'https://gitlab.com',
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: 10_000_000,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('GitLab credentials', () => {
  it('accepts personal access tokens and OAuth token pairs', () => {
    expect(gitLabCredentialsSchema.safeParse(pat).success).toBe(true);
    expect(gitLabCredentialsSchema.safeParse(oauth).success).toBe(true);
    expect(gitLabCredentialsSchema.safeParse({ instanceUrl: 'https://gitlab.com' }).success).toBe(
      false
    );
  });

  it('authenticates API requests per credential kind', () => {
    expect(gitLabAuthHeaders(pat)).toEqual({ 'PRIVATE-TOKEN': 'glpat-x' });
    expect(gitLabAuthHeaders(oauth)).toEqual({ Authorization: 'Bearer access' });
  });

  it('uses the oauth2 username for OAuth tokens over Git HTTPS', () => {
    expect(gitLabGitCredential(oauth, 'tdewitt')).toEqual({
      username: 'oauth2',
      password: 'access',
    });
    expect(gitLabGitCredential(pat, 'tdewitt')).toEqual({
      username: 'tdewitt',
      password: 'glpat-x',
    });
  });
});

describe('GitLab auth behavior', () => {
  it('declares device sign-in for gitlab.com before the token form', () => {
    expect(provider.capabilities.auth.methods.map((method) => method.kind)).toEqual([
      'oauth-device',
      'form',
    ]);
    expect(provider.capabilities.auth.methods[0]).toEqual({
      kind: 'oauth-device',
      clientId: GITLAB_OAUTH_CLIENT_ID,
      scopes: ['api', 'read_user'],
    });
  });

  it('completes device sign-in with gitlab.com OAuth credentials', async () => {
    const fetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(
        json(200, {
          device_code: 'device',
          user_code: 'N03SDJ4B',
          verification_uri: 'https://gitlab.com/oauth/device',
          expires_in: 300,
          interval: 0.001,
        })
      )
      .mockResolvedValueOnce(
        json(200, { access_token: 'access', refresh_token: 'refresh', expires_in: 7200 })
      );
    const session = await createGitLabAuthBehavior({ fetch }).startDeviceAuthorization();
    expect(session).toMatchObject({
      success: true,
      data: { userCode: 'N03SDJ4B', verificationUri: 'https://gitlab.com/oauth/device' },
    });
    if (!session.success) return;
    expect(session.data).not.toHaveProperty('deviceCode');
    const credentials = await session.data.complete(new AbortController().signal);
    expect(credentials).toMatchObject({
      success: true,
      data: { instanceUrl: 'https://gitlab.com', accessToken: 'access', refreshToken: 'refresh' },
    });
  });

  it('rejects a device sign-in token that cannot be refreshed', async () => {
    const fetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(
        json(200, {
          device_code: 'device',
          user_code: 'N03SDJ4B',
          verification_uri: 'https://gitlab.com/oauth/device',
          expires_in: 300,
          interval: 0.001,
        })
      )
      .mockResolvedValueOnce(json(200, { access_token: 'access', expires_in: 7200 }));
    const session = await createGitLabAuthBehavior({ fetch }).startDeviceAuthorization();
    if (!session.success) throw new Error('start failed');
    await expect(session.data.complete(new AbortController().signal)).resolves.toEqual({
      success: false,
      error: { type: 'generic', message: 'GitLab did not return a refreshable token.' },
    });
  });

  it('reports a failed device authorization request', async () => {
    const fetch = vi.fn<FetchLike>().mockRejectedValue(new TypeError('fetch failed'));
    await expect(createGitLabAuthBehavior({ fetch }).startDeviceAuthorization()).resolves.toEqual({
      success: false,
      error: { type: 'host_unreachable', message: 'Could not reach GitLab.' },
    });
  });

  describe('refreshCredentials', () => {
    it('leaves personal access tokens alone', async () => {
      const fetch = vi.fn<FetchLike>();
      await expect(
        createGitLabAuthBehavior({ fetch }).refreshCredentials(host, pat, 0)
      ).resolves.toEqual({ success: true, data: undefined });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('leaves OAuth credentials alone until they are within the refresh window', async () => {
      const fetch = vi.fn<FetchLike>();
      const now = oauth.expiresAt - GITLAB_REFRESH_SKEW_MS - 1;
      await expect(
        createGitLabAuthBehavior({ fetch }).refreshCredentials(host, oauth, now)
      ).resolves.toEqual({ success: true, data: undefined });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('rotates the token pair inside the refresh window', async () => {
      const fetch = vi
        .fn<FetchLike>()
        .mockResolvedValue(
          json(200, { access_token: 'new', refresh_token: 'new-refresh', expires_in: 7200 })
        );
      const now = oauth.expiresAt - 1000;
      await expect(
        createGitLabAuthBehavior({ fetch }).refreshCredentials(host, oauth, now)
      ).resolves.toEqual({
        success: true,
        data: {
          instanceUrl: 'https://gitlab.com',
          accessToken: 'new',
          refreshToken: 'new-refresh',
          expiresAt: now + 7_200_000,
        },
      });
      const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://gitlab.com/oauth/token');
      expect(new URLSearchParams(String(init.body)).get('refresh_token')).toBe('refresh');
    });

    it('reports a rejected refresh token as an auth failure', async () => {
      const fetch = vi.fn<FetchLike>().mockResolvedValue(json(400, { error: 'invalid_grant' }));
      await expect(
        createGitLabAuthBehavior({ fetch }).refreshCredentials(host, oauth, oauth.expiresAt)
      ).resolves.toMatchObject({ success: false, error: { type: 'auth_failed' } });
    });

    it('never sends a refresh token outside gitlab.com', async () => {
      const fetch = vi.fn<FetchLike>();
      const elsewhere = { ...oauth, instanceUrl: 'https://gitlab.example.com' };
      await expect(
        createGitLabAuthBehavior({ fetch }).refreshCredentials(host, elsewhere, oauth.expiresAt)
      ).resolves.toEqual({ success: true, data: undefined });
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});
