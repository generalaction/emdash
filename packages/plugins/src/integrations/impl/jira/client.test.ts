import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJiraClient, verifyJiraCredentials } from './client';
import { provider as integration } from './index';
import { jiraCredentialsSchema } from './types';

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), getCurrentUser: vi.fn() }));
vi.mock('jira.js', () => ({
  Version3Client: class {
    myself = { getCurrentUser: mocks.getCurrentUser };
    constructor(config: unknown) {
      mocks.createClient(config);
    }
  },
}));

describe('Jira client', () => {
  beforeEach(() => vi.clearAllMocks());

  it('configures the Jira SDK with OAuth2 bearer authentication', () => {
    const credentials = jiraCredentialsSchema.parse({
      authMethod: 'bearer',
      siteUrl: 'https://example.atlassian.net',
      accessToken: 'scoped-token',
      cloudId: 'cloud-1',
    });

    createJiraClient(credentials);

    expect(mocks.createClient).toHaveBeenCalledWith({
      host: 'https://api.atlassian.com/ex/jira/cloud-1',
      authentication: { oauth2: { accessToken: 'scoped-token' } },
    });
  });

  it('keeps legacy Basic Auth credentials on the Basic SDK path', () => {
    const credentials = jiraCredentialsSchema.parse({
      siteUrl: 'https://example.atlassian.net',
      email: 'user@example.com',
      apiToken: 'basic-token',
    });

    createJiraClient(credentials);

    expect(mocks.createClient).toHaveBeenCalledWith({
      host: 'https://example.atlassian.net',
      authentication: { basic: { email: 'user@example.com', apiToken: 'basic-token' } },
    });
  });
});

describe('Jira connection verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('verifies bearer credentials without inventing an email identity', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: 'cloud-1', url: 'https://example.atlassian.net/' }]))
    );
    mocks.getCurrentUser.mockResolvedValueOnce({
      accountId: 'account-1',
      displayName: 'Ada Lovelace',
    });

    const result = await verifyJiraCredentials(
      {
        siteUrl: 'https://example.atlassian.net',
        accessToken: 'scoped-token',
      },
      'bearer'
    );

    expect(result).toEqual({
      success: true,
      data: {
        account: { id: 'account-1', host: 'example.atlassian.net' },
        displayName: 'Ada Lovelace',
        displayDetail: 'Bearer token · example.atlassian.net',
        credentials: {
          authMethod: 'bearer',
          siteUrl: 'https://example.atlassian.net',
          accessToken: 'scoped-token',
          cloudId: 'cloud-1',
        },
      },
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.atlassian.com/oauth/token/accessible-resources',
      { headers: { Authorization: 'Bearer scoped-token' } }
    );
    expect(integration.capabilities.auth.methods).toHaveLength(2);
  });

  it('rejects a bearer token that cannot access the selected Jira site', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: 'cloud-2', url: 'https://other.atlassian.net' }]))
    );

    const result = await verifyJiraCredentials(
      {
        siteUrl: 'https://example.atlassian.net',
        accessToken: 'scoped-token',
      },
      'bearer'
    );

    expect(result).toMatchObject({ success: false, error: { type: 'generic' } });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('resolves the selected site again instead of trusting a supplied cloud ID', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: 'correct-cloud', url: 'https://example.atlassian.net' }]))
    );
    mocks.getCurrentUser.mockResolvedValueOnce({ accountId: 'account-1', displayName: 'Ada' });

    const result = await verifyJiraCredentials({
      authMethod: 'bearer',
      siteUrl: 'https://example.atlassian.net',
      accessToken: 'oauth-token',
      cloudId: 'another-sites-cloud',
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mocks.createClient).toHaveBeenCalledWith({
      host: 'https://api.atlassian.com/ex/jira/correct-cloud',
      authentication: { oauth2: { accessToken: 'oauth-token' } },
    });
    expect(result).toMatchObject({
      success: true,
      data: {
        account: { host: 'example.atlassian.net' },
        credentials: { cloudId: 'correct-cloud' },
      },
    });
  });

  it('rejects stored bearer credentials when their site is no longer accessible', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: 'other-cloud', url: 'https://other.atlassian.net' }]))
    );
    const result = await verifyJiraCredentials({
      authMethod: 'bearer',
      siteUrl: 'https://example.atlassian.net',
      accessToken: 'oauth-token',
      cloudId: 'other-cloud',
    });
    expect(result).toMatchObject({ success: false });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it.each([
    new Response('Unauthorized', { status: 401 }),
    new Response('{}'),
    new Response(JSON.stringify([{ id: '', url: 'https://example.atlassian.net' }])),
  ])('does not construct a client when resource discovery fails', async (response) => {
    vi.mocked(fetch).mockResolvedValueOnce(response);
    const result = await verifyJiraCredentials(
      {
        siteUrl: 'https://example.atlassian.net',
        accessToken: 'oauth-token',
      },
      'bearer'
    );
    expect(result).toMatchObject({ success: false });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('verifies legacy Basic credentials without discovery and returns their canonical shape', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce({ accountId: 'account-1', displayName: 'Ada' });
    const result = await verifyJiraCredentials({
      siteUrl: 'https://example.atlassian.net',
      email: 'user@example.com',
      apiToken: 'api-token',
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      data: {
        account: { id: 'account-1', host: 'example.atlassian.net', login: 'user@example.com' },
        credentials: { authMethod: 'basic', email: 'user@example.com', apiToken: 'api-token' },
      },
    });
  });

  it('rejects an unknown selected method before calling either API', async () => {
    const result = await verifyJiraCredentials(
      {
        siteUrl: 'https://example.atlassian.net',
        email: 'user@example.com',
        apiToken: 'api-token',
      },
      'unknown'
    );
    expect(result).toMatchObject({ success: false, error: { type: 'invalid_input' } });
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
