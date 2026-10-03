import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createJiraClient, readJiraCredentials, verifyJiraCredentials } from './client';
import { provider as integration } from './index';
import { jiraCredentialsSchema } from './types';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock('jira.js', () => ({
  Version3Client: class {
    myself = { getCurrentUser: mocks.getCurrentUser };

    constructor(config: unknown) {
      mocks.createClient(config);
    }
  },
}));

describe('Jira credentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts new Basic Auth credentials and preserves legacy Basic Auth records', () => {
    expect(
      jiraCredentialsSchema.parse({
        authMethod: 'basic',
        siteUrl: ' https://example.atlassian.net/ ',
        email: ' user@example.com ',
        apiToken: ' basic-token ',
      })
    ).toEqual({
      authMethod: 'basic',
      siteUrl: 'https://example.atlassian.net',
      email: 'user@example.com',
      apiToken: 'basic-token',
    });

    expect(
      jiraCredentialsSchema.parse({
        siteUrl: ' https://example.atlassian.net/ ',
        email: ' user@example.com ',
        apiToken: ' basic-token ',
      })
    ).toEqual({
      siteUrl: 'https://example.atlassian.net',
      email: 'user@example.com',
      apiToken: 'basic-token',
    });
  });

  it('accepts bearer credentials and rejects a bearer record without its token', () => {
    expect(
      readJiraCredentials({
        authMethod: 'bearer',
        siteUrl: 'https://example.atlassian.net/',
        accessToken: ' scoped-token ',
      })
    ).toEqual({
      success: true,
      data: {
        authMethod: 'bearer',
        siteUrl: 'https://example.atlassian.net',
        accessToken: 'scoped-token',
      },
    });

    expect(
      readJiraCredentials({
        authMethod: 'bearer',
        siteUrl: 'https://example.atlassian.net',
      })
    ).toMatchObject({ success: false, error: { type: 'invalid_input' } });
  });

  it('configures the Jira SDK with OAuth2 bearer authentication', () => {
    const credentials = jiraCredentialsSchema.parse({
      authMethod: 'bearer',
      siteUrl: 'https://example.atlassian.net',
      accessToken: 'scoped-token',
    });

    createJiraClient(credentials);

    expect(mocks.createClient).toHaveBeenCalledWith({
      host: 'https://example.atlassian.net',
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

  it('verifies bearer credentials without inventing an email identity', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce({
      accountId: 'account-1',
      displayName: 'Ada Lovelace',
    });

    const result = await verifyJiraCredentials({
      authMethod: 'bearer',
      siteUrl: 'https://example.atlassian.net',
      accessToken: 'scoped-token',
    });

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
        },
      },
    });
    expect(integration.capabilities.auth.methods).toHaveLength(2);
  });
});
