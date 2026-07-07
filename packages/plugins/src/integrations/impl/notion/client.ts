import { err, ok, type Result } from '@emdash/shared';
import { Client } from '@notionhq/client';
import { parseCredentials } from '../../helpers/credentials';
import type { IntegrationCredentials } from '../../host';
import type { IntegrationError } from '../../types';
import { toNotionIntegrationError } from './error';
import {
  type NotionClient,
  type NotionCredentials,
  notionCredentialsSchema,
  type NotionVerifiedConnection,
} from './types';

export function readNotionCredentials(
  credentials: IntegrationCredentials
): Result<NotionCredentials, IntegrationError> {
  return parseCredentials(notionCredentialsSchema, credentials);
}

export function createNotionClient(credentials: NotionCredentials): NotionClient {
  return new Client({ auth: credentials.apiToken });
}

export async function verifyNotionCredentials(
  rawCredentials: IntegrationCredentials
): Promise<Result<NotionVerifiedConnection, IntegrationError>> {
  const credentials = readNotionCredentials(rawCredentials);
  if (!credentials.success) return err(credentials.error);

  const client = createNotionClient(credentials.data);
  try {
    const user = await client.users.me({});
    const displayName = user.name ?? (user.type === 'bot' ? 'Notion bot' : 'Notion user');
    const displayDetail = user.type === 'person' ? user.person.email : undefined;
    return ok({
      displayName,
      ...(displayDetail ? { displayDetail } : {}),
      credentials: credentials.data,
    });
  } catch (error) {
    return err(toNotionIntegrationError(error, 'Failed to validate Notion token.'));
  }
}
