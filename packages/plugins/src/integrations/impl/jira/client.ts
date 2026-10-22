import { err, ok, type Result } from '@emdash/shared';
import { Version2Client, Version3Client } from 'jira.js';
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

  if (credentials.authMethod === 'pat') {
    // Data Center reads a personal access token as a plain Bearer header, which oauth2 sends.
    return new Version2Client({
      host: credentials.siteUrl,
      authentication: { oauth2: { accessToken: credentials.personalAccessToken } },
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
    const user =
      verifiedCredentials.authMethod === 'pat'
        ? await (client as Version2Client).myself.getCurrentUser()
        : await (client as Version3Client).myself.getCurrentUser();
    const host = new URL(verifiedCredentials.siteUrl).host;
    const email =
      verifiedCredentials.authMethod === 'basic' ? verifiedCredentials.email : undefined;
    // Data Center users have no accountId; their user key is the stable identifier.
    const accountId = user.accountId ?? user.key;
    const login = email ?? (verifiedCredentials.authMethod === 'pat' ? user.name : undefined);
    return ok({
      ...(accountId
        ? {
            account: {
              id: accountId,
              ...(login ? { login } : {}),
              host,
            },
          }
        : {}),
      displayName: user.displayName,
      displayDetail: `${authLabel(verifiedCredentials, email)} · ${host}`,
      credentials: verifiedCredentials,
    });
  } catch (error) {
    return err(toIntegrationError(error, 'Jira'));
  }
}

function authLabel(credentials: JiraCredentials, email: string | undefined): string {
  if (credentials.authMethod === 'bearer') return 'Bearer token';
  if (credentials.authMethod === 'pat') return 'Personal access token';
  return email ?? '';
}
