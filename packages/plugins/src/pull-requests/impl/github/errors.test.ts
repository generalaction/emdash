import { describe, expect, it } from 'vitest';
import { mapApiError, mapGitHubAuthError } from './errors';

function httpError(status: number, headers: Record<string, string> = {}) {
  return Object.assign(new Error(`HTTP ${status}`), { status, response: { headers } });
}

describe('mapApiError', () => {
  it('maps 401 to auth_required with a host-specific hint', () => {
    expect(mapApiError(httpError(401), 'fallback', 'github.com')).toEqual({
      type: 'auth_required',
      integrationId: 'github',
      host: 'github.com',
      hint: 'Connect GitHub from account settings.',
    });
    expect(mapApiError(httpError(401), 'fallback', 'ghe.example.com')).toEqual({
      type: 'auth_required',
      integrationId: 'github',
      host: 'ghe.example.com',
      hint: 'Run: gh auth login --hostname ghe.example.com',
    });
  });

  it('maps 404 to not_found_or_no_access naming the repository', () => {
    expect(mapApiError(httpError(404), 'fallback', 'github.com', 'acme/repo')).toEqual({
      type: 'not_found_or_no_access',
      host: 'github.com',
      message: 'Repository acme/repo was not found or is not accessible',
    });
  });

  it('maps 403 with a rate-limit reset to rate_limited', () => {
    expect(
      mapApiError(httpError(403, { 'x-ratelimit-reset': '100' }), 'fallback', 'github.com')
    ).toEqual({
      type: 'rate_limited',
      host: 'github.com',
      message: 'HTTP 403',
      resetAt: new Date(100_000).toISOString(),
    });
  });

  it('maps 403 with an SSO header to sso_required', () => {
    expect(
      mapApiError(
        httpError(403, { 'x-github-sso': 'required; url=https://github.com/orgs/acme/sso' }),
        'fallback',
        'github.com'
      )
    ).toEqual({
      type: 'sso_required',
      integrationId: 'github',
      host: 'github.com',
      message: 'HTTP 403',
      ssoUrl: 'https://github.com/orgs/acme/sso',
    });
  });

  it('maps any other 403 to forbidden', () => {
    expect(mapApiError(httpError(403), 'fallback', 'github.com')).toEqual({
      type: 'forbidden',
      host: 'github.com',
      message: 'HTTP 403',
    });
  });
});

describe('mapGitHubAuthError', () => {
  it('keeps a desktop-supplied hint for auth_required', () => {
    expect(
      mapGitHubAuthError({
        type: 'auth_required',
        host: 'github.com',
        message: 'No account',
        hint: 'Connect a GitHub account from settings.',
      })
    ).toEqual({
      type: 'auth_required',
      integrationId: 'github',
      host: 'github.com',
      hint: 'Connect a GitHub account from settings.',
    });
  });

  it('maps an unresolvable identity to account_not_found', () => {
    expect(
      mapGitHubAuthError({
        type: 'account_unresolvable',
        host: 'github.com',
        message: 'No open project',
      })
    ).toEqual({ type: 'account_not_found', integrationId: 'github', message: 'No open project' });
  });
});
