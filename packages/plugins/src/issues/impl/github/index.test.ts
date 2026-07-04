import { noopLogger } from '@emdash/shared/logger';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { provider } from './index';

const issues = provider.behavior.issues;
if (!issues) throw new Error('GitHub issues plugin has no issues behavior');

const host = { log: noopLogger, credentials: { accessToken: 'gho_test' } };
const repositoryUrl = 'https://github.com/acme/widgets';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

function stubFetch(response: Response | Promise<Response>) {
  const fetchMock = vi.fn().mockReturnValue(Promise.resolve(response));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('github issues plugin', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists open repository issues and filters out pull requests', async () => {
    const fetchMock = stubFetch(
      jsonResponse(200, [
        {
          number: 12,
          title: 'Fix login',
          html_url: 'https://github.com/acme/widgets/issues/12',
          state: 'open',
          updated_at: '2026-05-01T10:00:00Z',
          assignees: [{ login: 'octocat' }, null],
          body: 'Users cannot log in.',
        },
        {
          number: 13,
          title: 'A pull request',
          html_url: 'https://github.com/acme/widgets/pull/13',
          state: 'open',
          updated_at: '2026-05-02T10:00:00Z',
          pull_request: { url: 'https://api.github.com/repos/acme/widgets/pulls/13' },
        },
      ])
    );

    const result = await issues.listIssues(host, { repositoryUrl, limit: 7 });

    const requestUrl = new URL(fetchMock.mock.calls[0]?.[0] as string);
    const options = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(requestUrl.origin).toBe('https://api.github.com');
    expect(requestUrl.pathname).toBe('/repos/acme/widgets/issues');
    expect(requestUrl.searchParams.get('state')).toBe('open');
    expect(requestUrl.searchParams.get('per_page')).toBe('7');
    expect(requestUrl.searchParams.get('sort')).toBe('updated');
    expect(requestUrl.searchParams.get('direction')).toBe('desc');
    expect(options.headers.authorization).toBe('token gho_test');

    expect(result).toEqual({
      success: true,
      data: [
        {
          identifier: '#12',
          title: 'Fix login',
          url: 'https://github.com/acme/widgets/issues/12',
          description: 'Users cannot log in.',
          status: 'open',
          assignees: ['octocat'],
          updatedAt: '2026-05-01T10:00:00Z',
        },
      ],
    });
  });

  it('targets a GitHub Enterprise API base URL from credentials', async () => {
    const fetchMock = stubFetch(jsonResponse(200, []));
    const ghesHost = {
      log: noopLogger,
      credentials: { accessToken: 'ghe_token', apiBaseUrl: 'https://ghe.example.com/api/v3' },
    };

    const result = await issues.listIssues(ghesHost, {
      repositoryUrl: 'https://ghe.example.com/acme/widgets',
      limit: 5,
    });

    expect(result).toEqual({ success: true, data: [] });
    const requestUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(requestUrl.startsWith('https://ghe.example.com/api/v3/repos/acme/widgets/issues')).toBe(
      true
    );
  });

  it('searches issues scoped to the repository', async () => {
    const fetchMock = stubFetch(
      jsonResponse(200, {
        total_count: 1,
        incomplete_results: false,
        items: [
          {
            number: 7,
            title: 'Dark mode bug',
            html_url: 'https://github.com/acme/widgets/issues/7',
            state: 'open',
            updated_at: '2026-05-03T10:00:00Z',
          },
        ],
      })
    );

    const result = await issues.searchIssues(host, {
      repositoryUrl,
      searchTerm: 'bug',
      limit: 3,
    });

    const requestUrl = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(requestUrl.pathname).toBe('/search/issues');
    expect(requestUrl.searchParams.get('q')).toBe('bug repo:acme/widgets is:issue is:open');
    expect(requestUrl.searchParams.get('per_page')).toBe('3');
    expect(requestUrl.searchParams.get('sort')).toBe('updated');
    expect(requestUrl.searchParams.get('order')).toBe('desc');

    expect(result).toEqual({
      success: true,
      data: [expect.objectContaining({ identifier: '#7', title: 'Dark mode bug' })],
    });
  });

  it('returns an empty result for a blank search term without calling GitHub', async () => {
    const fetchMock = stubFetch(jsonResponse(200, []));

    const result = await issues.searchIssues(host, { repositoryUrl, searchTerm: '   ', limit: 3 });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, data: [] });
  });

  describe('error mapping', () => {
    const listWithResponse = (response: Response) => {
      stubFetch(response);
      return issues.listIssues(host, { repositoryUrl, limit: 5 });
    };

    it('maps 401 to auth_failed', async () => {
      const result = await listWithResponse(jsonResponse(401, { message: 'Bad credentials' }));

      expect(result).toEqual({
        success: false,
        error: {
          type: 'auth_failed',
          message: 'GitHub authentication failed. Check your credentials.',
        },
      });
    });

    it('maps 403 with an SSO header to sso_required with the authorization URL', async () => {
      const result = await listWithResponse(
        jsonResponse(
          403,
          { message: 'Resource protected by organization SAML enforcement.' },
          {
            'x-github-sso':
              'required; url=https://github.com/orgs/acme/sso?authorization_request=abc123',
          }
        )
      );

      expect(result).toEqual({
        success: false,
        error: {
          type: 'sso_required',
          message: 'GitHub requires single sign-on authorization for this organization.',
          ssoUrl: 'https://github.com/orgs/acme/sso?authorization_request=abc123',
        },
      });
    });

    it('maps 403 with an exhausted rate limit to rate_limited with resetAt', async () => {
      const resetEpochSeconds = 1750000000;
      const result = await listWithResponse(
        jsonResponse(
          403,
          { message: 'API rate limit exceeded' },
          { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetEpochSeconds) }
        )
      );

      expect(result).toEqual({
        success: false,
        error: {
          type: 'rate_limited',
          message: 'GitHub API rate limit exceeded. Please try again shortly.',
          resetAt: new Date(resetEpochSeconds * 1000).toISOString(),
        },
      });
    });

    it('maps a plain 403 to auth_failed', async () => {
      const result = await listWithResponse(jsonResponse(403, { message: 'Forbidden' }));

      expect(result).toEqual({
        success: false,
        error: {
          type: 'auth_failed',
          message: 'GitHub credentials were accepted but are missing required permissions.',
        },
      });
    });

    it('maps 404 to not_found_or_no_access', async () => {
      const result = await listWithResponse(jsonResponse(404, { message: 'Not Found' }));

      expect(result).toEqual({
        success: false,
        error: {
          type: 'not_found_or_no_access',
          message: 'GitHub resource was not found or you do not have access.',
        },
      });
    });

    it('maps 429 to rate_limited', async () => {
      const result = await listWithResponse(jsonResponse(429, { message: 'Too many requests' }));

      expect(result).toEqual({
        success: false,
        error: {
          type: 'rate_limited',
          message: 'GitHub API rate limit exceeded. Please try again shortly.',
        },
      });
    });

    it('maps 5xx to host_unreachable', async () => {
      const result = await listWithResponse(jsonResponse(502, { message: 'Bad gateway' }));

      expect(result).toEqual({
        success: false,
        error: {
          type: 'host_unreachable',
          message: 'GitHub API is temporarily unavailable. Please try again.',
        },
      });
    });

    it('maps network failures to host_unreachable', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

      const result = await issues.listIssues(host, { repositoryUrl, limit: 5 });

      expect(result).toEqual({
        success: false,
        error: {
          type: 'host_unreachable',
          message: 'GitHub API is temporarily unavailable. Please try again.',
        },
      });
    });

    it('returns an invalid input error when the access token is missing', async () => {
      const fetchMock = stubFetch(jsonResponse(200, []));

      const result = await issues.listIssues(
        { log: noopLogger, credentials: {} },
        { repositoryUrl, limit: 5 }
      );

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        error: { type: 'invalid_input', message: 'GitHub access token is required.' },
      });
    });

    it('returns an invalid input error for an unparsable repository URL', async () => {
      const fetchMock = stubFetch(jsonResponse(200, []));

      const result = await issues.listIssues(host, { repositoryUrl: 'not-a-url', limit: 5 });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        error: { type: 'invalid_input', message: 'Unable to parse repository URL.' },
      });
    });

    it('returns unsupported host when the remote does not match configured GitHub host', async () => {
      const fetchMock = stubFetch(jsonResponse(200, []));

      const result = await issues.listIssues(host, {
        repositoryUrl: 'https://ghe.example.com/acme/widgets',
        limit: 5,
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        error: {
          type: 'unsupported_host',
          message:
            'Git remote host "ghe.example.com" does not match configured GitHub instance "github.com".',
        },
      });
    });
  });
});
