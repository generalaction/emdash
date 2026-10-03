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
    return new Version3Client({
      host: credentials.siteUrl,
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

  const client = createJiraClient(credentials.data);
  try {
    const user = await client.myself.getCurrentUser();
    const host = new URL(credentials.data.siteUrl).host;
    const isBearer = 'authMethod' in credentials.data && credentials.data.authMethod === 'bearer';
    const email = 'email' in credentials.data ? credentials.data.email : undefined;
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
      credentials: credentials.data,
    });
  } catch (error) {
    return err(toIntegrationError(error, 'Jira'));
  }
}
