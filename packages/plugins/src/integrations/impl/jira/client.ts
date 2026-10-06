import { err, ok, type Result } from '@emdash/shared';
import { Version3Client } from 'jira.js';
import { parseCredentials } from '../../helpers/credentials';
import { toIntegrationError } from '../../helpers/error';
import type { IntegrationCredentials } from '../../host';
import type { IntegrationError } from '../../types';
import {
  type JiraClient,
  type JiraCredentials,
  jiraCredentialsSchema,
  type JiraVerifiedConnection,
} from './types';

export function readJiraCredentials(
  credentials: IntegrationCredentials
): Result<JiraCredentials, IntegrationError> {
  return parseCredentials(jiraCredentialsSchema, credentials);
}

export function createJiraClient(credentials: JiraCredentials): JiraClient {
  if ('authMethod' in credentials && credentials.authMethod === 'bearer') {
    if (!credentials.cloudId) {
      throw new Error('Jira bearer credentials must be verified before use.');
    }
    return new Version3Client({
      host: `https://api.atlassian.com/ex/jira/${encodeURIComponent(credentials.cloudId)}`,
      authentication: { oauth2: { accessToken: credentials.accessToken } },
    });
  }

  return new Version3Client({
    host: credentials.siteUrl,
    authentication: {
      basic: {
        email: credentials.email,
        apiToken: credentials.apiToken,
      },
    },
  });
}

export async function verifyJiraCredentials(
  rawCredentials: IntegrationCredentials
): Promise<Result<JiraVerifiedConnection, IntegrationError>> {
  const credentials = readJiraCredentials(rawCredentials);
  if (!credentials.success) return err(credentials.error);

  try {
    const verifiedCredentials =
      'authMethod' in credentials.data && credentials.data.authMethod === 'bearer'
        ? {
            ...credentials.data,
            cloudId:
              credentials.data.cloudId ??
              (await resolveJiraCloudId(credentials.data.siteUrl, credentials.data.accessToken)),
          }
        : credentials.data;
    const client = createJiraClient(verifiedCredentials);
    const user = await client.myself.getCurrentUser();
    const host = new URL(verifiedCredentials.siteUrl).host;
    const isBearer =
      'authMethod' in verifiedCredentials && verifiedCredentials.authMethod === 'bearer';
    const email = 'email' in verifiedCredentials ? verifiedCredentials.email : undefined;
    return ok({
      ...(user.accountId
        ? {
            account: {
              id: user.accountId,
              ...(email ? { login: email } : {}),
              host,
            },
          }
        : {}),
      displayName: user.displayName,
      displayDetail: `${isBearer ? 'Bearer token' : email} · ${host}`,
      credentials: verifiedCredentials,
    });
  } catch (error) {
    return err(toIntegrationError(error, 'Jira'));
  }
}

async function resolveJiraCloudId(siteUrl: string, accessToken: string): Promise<string> {
  const response = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error('Unable to find Jira sites available to this bearer token.');
  }

  const resources: unknown = await response.json();
  if (!Array.isArray(resources)) {
    throw new Error('Atlassian returned an invalid list of accessible Jira sites.');
  }

  const normalizedSiteUrl = normalizeSiteUrl(siteUrl);
  const resource = resources.find(
    (candidate): candidate is { id: string; url: string } =>
      typeof candidate === 'object' &&
      candidate !== null &&
      typeof candidate.id === 'string' &&
      typeof candidate.url === 'string' &&
      normalizeSiteUrl(candidate.url) === normalizedSiteUrl
  );
  if (!resource) {
    throw new Error('This bearer token does not have access to the specified Jira site.');
  }
  return resource.id;
}

function normalizeSiteUrl(siteUrl: string): string {
  return new URL(siteUrl).toString().replace(/\/$/, '');
}
