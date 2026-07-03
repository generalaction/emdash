import { err, ok, type Result } from '@emdash/shared';
import { userGetCurrent } from '@llamaduck/forgejo-ts';
import { createClient } from '@llamaduck/forgejo-ts/client';
import { parseCredentials } from '../../helpers/credentials';
import { toIntegrationError } from '../../helpers/error';
import type { IntegrationCredentials } from '../../host';
import type { IntegrationError } from '../../types';
import {
  type ForgejoClient,
  type ForgejoCredentials,
  forgejoCredentialsSchema,
  type ForgejoVerifiedConnection,
} from './types';

export function readForgejoCredentials(
  credentials: IntegrationCredentials
): Result<ForgejoCredentials, IntegrationError> {
  return parseCredentials(forgejoCredentialsSchema, credentials);
}

export function createForgejoClient(credentials: ForgejoCredentials): ForgejoClient {
  return createClient({
    baseURL: `${credentials.instanceUrl}/api/v1`,
    headers: { Authorization: `token ${credentials.apiToken}` },
  });
}

export async function verifyForgejoCredentials(
  rawCredentials: IntegrationCredentials
): Promise<Result<ForgejoVerifiedConnection, IntegrationError>> {
  const credentials = readForgejoCredentials(rawCredentials);
  if (!credentials.success) return err(credentials.error);

  const client = createForgejoClient(credentials.data);
  try {
    const { data: user } = await userGetCurrent({ client, throwOnError: true });
    const username = user.login;
    const displayName = user.full_name;

    const host = new URL(credentials.data.instanceUrl).host;
    const displayDetail =
      username && displayName && username !== displayName ? `@${username} · ${host}` : host;

    return ok({
      displayName,
      displayDetail,
      credentials: credentials.data,
    });
  } catch (error) {
    return err(toIntegrationError(error, 'Forgejo'));
  }
}
