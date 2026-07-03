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
    return ok({
      displayName: user.displayName,
      displayDetail: `${credentials.data.email} · ${new URL(credentials.data.siteUrl).host}`,
      credentials: credentials.data,
    });
  } catch (error) {
    return err(toIntegrationError(error, 'Jira'));
  }
}
