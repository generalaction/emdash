import { err, ok, type Result } from '@emdash/shared';
import { Version3Client } from 'jira.js';
import { parseCredentials } from '../../helpers/credentials';
import { toIntegrationError } from '../../helpers/error';
import type { IntegrationCredentials } from '../../host';
import type { IntegrationError } from '../../types';
import { resolveJiraCloudId } from './cloud-resources';
import {
  type JiraClient,
  jiraConnectionInputSchema,
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
  if (credentials.authMethod === 'bearer') {
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
  rawCredentials: IntegrationCredentials,
  methodId?: string
): Promise<Result<JiraVerifiedConnection, IntegrationError>> {
  const credentials = parseCredentials(
    jiraConnectionInputSchema,
    methodId === undefined ? rawCredentials : { ...rawCredentials, authMethod: methodId }
  );
  if (!credentials.success) return err(credentials.error);

  try {
    const verifiedCredentials: JiraCredentials =
      credentials.data.authMethod === 'bearer'
        ? {
            ...credentials.data,
            cloudId: await resolveJiraCloudId(
              credentials.data.siteUrl,
              credentials.data.accessToken
            ),
          }
        : credentials.data;
    const client = createJiraClient(verifiedCredentials);
    const user = await client.myself.getCurrentUser();
    const host = new URL(verifiedCredentials.siteUrl).host;
    const isBearer = verifiedCredentials.authMethod === 'bearer';
    const email =
      verifiedCredentials.authMethod === 'basic' ? verifiedCredentials.email : undefined;
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
