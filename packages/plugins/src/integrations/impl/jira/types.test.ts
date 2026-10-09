import { describe, expect, expectTypeOf, it } from 'vitest';
import { readJiraCredentials } from './client';
import { jiraConnectionInputSchema, jiraCredentialsSchema, type JiraCredentials } from './types';

const basic = {
  siteUrl: 'https://example.atlassian.net',
  email: 'user@example.com',
  apiToken: 'basic-token',
};
const bearer = {
  authMethod: 'bearer',
  siteUrl: 'https://example.atlassian.net',
  accessToken: 'oauth-token',
};

describe('Jira credential boundaries', () => {
  it('normalizes old and new Basic credentials to the same shape', () => {
    const expected = { ...basic, authMethod: 'basic' };
    expect(jiraCredentialsSchema.parse(basic)).toEqual(expected);
    expect(
      jiraCredentialsSchema.parse({
        authMethod: 'basic',
        siteUrl: ' https://example.atlassian.net/ ',
        email: ' user@example.com ',
        apiToken: ' basic-token ',
      })
    ).toEqual(expected);
  });

  it('accepts bearer input without a cloud ID and discards submitted connection metadata', () => {
    expect(
      jiraConnectionInputSchema.parse({
        ...bearer,
        accessToken: ' oauth-token ',
        cloudId: 'untrusted-cloud',
        email: 'stale@example.com',
        apiToken: 'stale-token',
      })
    ).toEqual(bearer);
  });

  it('requires a resolved cloud ID when reading stored bearer credentials', () => {
    expect(readJiraCredentials(bearer)).toMatchObject({
      success: false,
      error: { type: 'invalid_input' },
    });
    expect(readJiraCredentials({ ...bearer, cloudId: ' ' }).success).toBe(false);
    expect(readJiraCredentials({ ...bearer, cloudId: ' cloud-1 ' })).toEqual({
      success: true,
      data: { ...bearer, cloudId: 'cloud-1' },
    });
    expectTypeOf<
      Extract<JiraCredentials, { authMethod: 'bearer' }>['cloudId']
    >().toEqualTypeOf<string>();
  });

  it('rejects unknown methods and incomplete bearer inputs without falling back to Basic', () => {
    for (const credentials of [
      { ...basic, authMethod: 'unknown' },
      { ...basic, authMethod: 'bearer' },
      { ...bearer, accessToken: '' },
    ]) {
      expect(jiraConnectionInputSchema.safeParse(credentials).success).toBe(false);
      expect(jiraCredentialsSchema.safeParse(credentials).success).toBe(false);
    }
  });
});
