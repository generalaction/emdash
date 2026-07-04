import { err, ok, type Result } from '@emdash/shared';
import { PlainClient as PlainSdkClient } from '@team-plain/graphql';
import { parseCredentials } from '../../helpers/credentials';
import type { IntegrationCredentials } from '../../host';
import type { IntegrationError } from '../../types';
import { toPlainIntegrationError } from './error';
import {
  type PlainClient,
  type PlainCredentials,
  plainCredentialsSchema,
  type PlainVerifiedConnection,
} from './types';

export function readPlainCredentials(
  credentials: IntegrationCredentials
): Result<PlainCredentials, IntegrationError> {
  return parseCredentials(plainCredentialsSchema, credentials);
}

export function createPlainClient(credentials: PlainCredentials): PlainClient {
  return new PlainSdkClient({ apiKey: credentials.apiKey });
}

export async function verifyPlainCredentials(
  rawCredentials: IntegrationCredentials
): Promise<Result<PlainVerifiedConnection, IntegrationError>> {
  const credentials = readPlainCredentials(rawCredentials);
  if (!credentials.success) return err(credentials.error);

  const client = createPlainClient(credentials.data);
  try {
    const workspace = await client.query.myWorkspace();
    return ok({
      displayName: workspace.name || workspace.publicName || undefined,
      credentials: credentials.data,
    });
  } catch (error) {
    return err(toPlainIntegrationError(error, 'Failed to validate Plain API key.'));
  }
}
