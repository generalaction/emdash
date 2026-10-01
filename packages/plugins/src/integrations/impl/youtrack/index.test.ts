import { beforeEach, describe, expect, it } from 'vitest';
import { createYouTrackClient, verifyYouTrackCredentials } from './client';
import { toYouTrackIntegrationError } from './error';
import { provider as integration } from './index';
import { json, createYouTrackTestServer } from './test-utils';
import { youTrackCredentialsSchema } from './types';

const user = { id: '1-3', login: 'ada', fullName: 'Ada Lovelace' };
const http = createYouTrackTestServer();
const { requests, host } = http;
let instanceUrl: string;

beforeEach(() => {
  instanceUrl = http.instanceUrl;
  http.handler = (_request, response) => json(response, user);
});

describe('YouTrack connection', () => {
  it('verifies real HTTP credentials and scopes identity to the complete installation URL', async () => {
    const result = await verifyYouTrackCredentials({
      instanceUrl: ` ${instanceUrl}/ `,
      apiToken: ' test-token ',
    });
    expect(result).toEqual({
      success: true,
      data: {
        credentials: { instanceUrl, apiToken: 'test-token' },
        account: { id: '1-3', login: 'ada', host: new URL(instanceUrl).host, scope: instanceUrl },
        displayName: 'Ada Lovelace',
        displayDetail: `ada · ${instanceUrl}`,
      },
    });
    expect(requests[0]?.url.pathname).toBe('/youtrack/api/users/me');
    expect(requests[0]?.url.searchParams.get('fields')).toBe('id,login,fullName');
    expect(requests[0]?.authorization).toBe('Bearer test-token');
    const other = await verifyYouTrackCredentials({
      instanceUrl: instanceUrl.replace('/youtrack', '/other'),
      apiToken: 'test-token',
    });
    expect(other.success && other.data.account.scope).not.toBe(
      result.success && result.data.account.scope
    );
  });

  it.each([
    'file:///tmp/youtrack',
    'https://user:password@example.com',
    'https://example.com?token=secret',
    'https://example.com/#fragment',
  ])('rejects unsafe instance URL %s before HTTP access', async (url) => {
    const result = await verifyYouTrackCredentials({ instanceUrl: url, apiToken: 'test-token' });
    expect(result.success).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it('supports both Cloud and self hosted connection configuration and exposes the official icon', () => {
    expect(
      youTrackCredentialsSchema.parse({
        instanceUrl: 'https://team.youtrack.cloud/',
        apiToken: ' perm:token ',
      })
    ).toEqual({
      instanceUrl: 'https://team.youtrack.cloud',
      apiToken: 'perm:token',
    });
    expect(integration.assets.icon?.alt).toBe('YouTrack');
    expect(integration.capabilities.auth.methods[0]?.kind).toBe('form');
  });

  it.each([
    [400, 'generic'],
    [401, 'auth_failed'],
    [403, 'auth_failed'],
    [404, 'not_found_or_no_access'],
    [429, 'rate_limited'],
    [503, 'host_unreachable'],
  ])('maps HTTP %s without exposing the response body', async (status, type) => {
    http.handler = (_request, response) => json(response, { error: 'secret-token' }, status);
    const result = await verifyYouTrackCredentials(host().credentials);
    expect(result).toMatchObject({ success: false, error: { type } });
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });

  it('rejects invalid remote responses', async () => {
    http.handler = (_request, response) => json(response, { id: null });
    expect(await verifyYouTrackCredentials(host().credentials)).toEqual({
      success: false,
      error: { type: 'generic', message: 'YouTrack returned an invalid API response.' },
    });
  });

  it('sanitizes invalid JSON errors', async () => {
    http.handler = (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('secret-token');
    };
    expect(await verifyYouTrackCredentials(host().credentials)).toEqual({
      success: false,
      error: { type: 'generic', message: 'YouTrack returned an invalid API response.' },
    });
  });

  it('does not forward tokens through redirects', async () => {
    http.handler = (_request, response) => {
      response.writeHead(302, { Location: `${instanceUrl}/other` });
      response.end();
    };
    expect((await verifyYouTrackCredentials(host().credentials)).success).toBe(false);
    expect(requests).toHaveLength(1);
  });

  it('aborts a stalled HTTP request', async () => {
    http.handler = () => {};
    const client = createYouTrackClient(
      { instanceUrl, apiToken: 'test-token' },
      AbortSignal.timeout(20)
    );
    await expect(
      client.Users.getCurrentUserProfile({ fields: ['id', 'login', 'fullName'] }).catch(
        toYouTrackIntegrationError
      )
    ).resolves.toEqual({
      type: 'host_unreachable',
      message: 'Unable to reach YouTrack. Check your instance URL and network connection.',
    });
  });

  it('maps a disconnected HTTP request to a connection error', async () => {
    http.handler = (request) => request.socket.destroy();
    expect(await verifyYouTrackCredentials(host().credentials)).toEqual({
      success: false,
      error: {
        type: 'host_unreachable',
        message: 'Unable to reach YouTrack. Check your instance URL and network connection.',
      },
    });
  });
});
