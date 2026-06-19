import { describe, expect, it } from 'vitest';
import { classifyGitHubApiError } from './github-api-errors';

describe('classifyGitHubApiError', () => {
  it('classifies 401 as auth required with host-specific guidance', () => {
    expect(
      classifyGitHubApiError(
        { status: 401 },
        { host: 'ghe.example.com', fallback: 'Unable to load GitHub data' }
      )
    ).toEqual({
      type: 'auth_required',
      host: 'ghe.example.com',
      status: 401,
      message:
        'GitHub Enterprise authentication required for ghe.example.com. Run: gh auth login --hostname ghe.example.com',
      hint: 'Run: gh auth login --hostname ghe.example.com',
    });
  });

  it('classifies 404 as repository not found or no access', () => {
    expect(
      classifyGitHubApiError(
        { status: 404 },
        {
          host: 'github.com',
          nameWithOwner: 'acme/repo',
          fallback: 'Unable to load GitHub data',
        }
      )
    ).toEqual({
      type: 'not_found_or_no_access',
      host: 'github.com',
      nameWithOwner: 'acme/repo',
      status: 404,
      message:
        'acme/repo on github.com was not found, or the selected GitHub account does not have access.',
    });
  });

  it('classifies SSO-flavoured 403 responses separately', () => {
    expect(
      classifyGitHubApiError(
        {
          status: 403,
          response: {
            headers: {
              'x-github-sso':
                'required; url=https://github.com/orgs/acme/sso?authorization_request=1',
            },
            data: { message: 'Resource protected by organization SAML enforcement.' },
          },
        },
        { host: 'github.com', fallback: 'Unable to load GitHub data' }
      )
    ).toEqual({
      type: 'sso_required',
      host: 'github.com',
      status: 403,
      ssoUrl: 'https://github.com/orgs/acme/sso?authorization_request=1',
      message: 'Resource protected by organization SAML enforcement.',
    });
  });

  it('classifies rate limit 403 responses separately', () => {
    expect(
      classifyGitHubApiError(
        {
          status: 403,
          response: {
            headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' },
            data: { message: 'API rate limit exceeded.' },
          },
        },
        { host: 'github.com', fallback: 'Unable to load GitHub data' }
      )
    ).toEqual({
      type: 'rate_limited',
      host: 'github.com',
      status: 403,
      resetAt: '2023-11-14T22:13:20.000Z',
      message: 'API rate limit exceeded.',
    });
  });

  it('classifies remaining 403 responses as forbidden', () => {
    expect(
      classifyGitHubApiError(
        { status: 403, response: { data: { message: 'Forbidden' } } },
        { host: 'github.com', fallback: 'Unable to load GitHub data' }
      )
    ).toEqual({
      type: 'forbidden',
      host: 'github.com',
      status: 403,
      message: 'Forbidden',
    });
  });

  it('classifies network failures as host unreachable', () => {
    const error = Object.assign(new Error('connect timeout'), { code: 'ETIMEDOUT' });

    expect(
      classifyGitHubApiError(error, {
        host: 'ghe.example.com',
        fallback: 'Unable to load GitHub data',
      })
    ).toEqual({
      type: 'host_unreachable',
      host: 'ghe.example.com',
      reason: 'connect timeout',
    });
  });

  it('extracts GraphQL error messages for generic API errors', () => {
    expect(
      classifyGitHubApiError(
        {
          response: {
            data: {
              errors: [{ message: 'Something went wrong in GraphQL' }],
            },
          },
        },
        { host: 'github.com', fallback: 'Unable to load GitHub data' }
      )
    ).toEqual({
      type: 'api_error',
      message: 'Something went wrong in GraphQL',
    });
  });

  it('classifies Octokit GraphQL NOT_FOUND errors as repository not found or no access', () => {
    expect(
      classifyGitHubApiError(
        {
          name: 'GraphqlResponseError',
          headers: {},
          errors: [
            {
              type: 'NOT_FOUND',
              message: 'Could not resolve to a Repository with the name acme/repo.',
            },
          ],
          data: { repository: null },
        },
        {
          host: 'github.com',
          nameWithOwner: 'acme/repo',
          fallback: 'Unable to load GitHub data',
        }
      )
    ).toEqual({
      type: 'not_found_or_no_access',
      host: 'github.com',
      nameWithOwner: 'acme/repo',
      message:
        'acme/repo on github.com was not found, or the selected GitHub account does not have access.',
    });
  });

  it('classifies Octokit GraphQL rate limit errors without REST status', () => {
    expect(
      classifyGitHubApiError(
        {
          name: 'GraphqlResponseError',
          headers: { 'x-ratelimit-reset': '1700000000' },
          response: {
            data: null,
            errors: [{ message: 'You have exceeded a secondary rate limit.' }],
          },
        },
        { host: 'github.com', fallback: 'Unable to load GitHub data' }
      )
    ).toEqual({
      type: 'rate_limited',
      host: 'github.com',
      status: 200,
      resetAt: '2023-11-14T22:13:20.000Z',
      message: 'You have exceeded a secondary rate limit.',
    });
  });

  it('classifies Octokit GraphQL 403 rate limit errors from headers.status', () => {
    expect(
      classifyGitHubApiError(
        {
          name: 'GraphqlResponseError',
          headers: {
            status: '403',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': '1700000000',
          },
          errors: [{ message: 'API rate limit exceeded.' }],
        },
        { host: 'github.com', fallback: 'Unable to load GitHub data' }
      )
    ).toEqual({
      type: 'rate_limited',
      host: 'github.com',
      status: 403,
      resetAt: '2023-11-14T22:13:20.000Z',
      message: 'API rate limit exceeded.',
    });
  });

  it('classifies Octokit GraphQL FORBIDDEN errors as forbidden', () => {
    expect(
      classifyGitHubApiError(
        {
          name: 'GraphqlResponseError',
          headers: {},
          errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible by integration' }],
        },
        { host: 'github.com', fallback: 'Unable to load GitHub data' }
      )
    ).toEqual({
      type: 'forbidden',
      host: 'github.com',
      status: 403,
      message: 'Resource not accessible by integration',
    });
  });

  it('classifies Octokit GraphQL 403 errors without stronger signal as forbidden', () => {
    expect(
      classifyGitHubApiError(
        {
          name: 'GraphqlResponseError',
          headers: { status: '403' },
          errors: [{ message: 'Something was forbidden' }],
        },
        { host: 'github.com', fallback: 'Unable to load GitHub data' }
      )
    ).toEqual({
      type: 'forbidden',
      host: 'github.com',
      status: 403,
      message: 'Something was forbidden',
    });
  });
});
